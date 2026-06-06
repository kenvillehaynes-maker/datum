/*
 * health-sync.js
 * Pulls completed running and cycling workouts from Apple Health (via a Capacitor
 * health plugin) and writes them into the Sub-20 tracker progress model.
 *
 * Design: the ONLY plugin-specific code is in readWorkoutsFromHealth(). Everything
 * else (date matching, pace maths, merge into progress) is plugin-agnostic. If you
 * install a different health plugin, you only rewrite that one adapter function to
 * match its documented API, then return the normalised shape it expects.
 *
 * Default target plugin: capacitor-health (mley). Read permissions used:
 *   READ_WORKOUTS, READ_DISTANCE, READ_HEART_RATE
 */
(function () {
  'use strict';

  var APP = window.SUB20; // bridge exposed at the end of index.html
  if (!APP) { console.warn('[health-sync] SUB20 bridge missing; nothing to sync into'); return; }

  var DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // Mon=0 .. Sun=6
  var MS_DAY = 86400000;
  var RUN_TYPES = ['quality', 'easy', 'long', 'trial', 'race'];

  // ---- date helpers -------------------------------------------------------
  // Week n starts on PLAN_START_DATE (the Monday of week 1) plus (n-1)*7 days.
  function sessionDate(weekN, dayName) {
    var dayIdx = DAY.indexOf(dayName);
    if (dayIdx < 0) dayIdx = 0;
    var offset = (weekN - 1) * 7 + dayIdx;
    var d = new Date(APP.PLAN_START_DATE.getTime() + offset * MS_DAY);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  // ---- pace maths ---------------------------------------------------------
  function paceFrom(distanceMeters, durationSeconds) {
    if (!distanceMeters || !durationSeconds) return '';
    var km = distanceMeters / 1000;
    if (km < 0.4) return ''; // ignore tiny GPS fragments
    var secPerKm = durationSeconds / km;
    var m = Math.floor(secPerKm / 60);
    var s = Math.round(secPerKm % 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ':' + (s < 10 ? '0' + s : s) + '/km';
  }

  function modalityOf(typeStr) {
    var tp = String(typeStr || '').toLowerCase();
    if (tp.indexOf('cycl') > -1 || tp.indexOf('bike') > -1) return 'bike';
    if (tp.indexOf('run') > -1) return 'run';
    return 'other';
  }

  // ---- PLUGIN ADAPTER (rewrite this block to match your plugin) -----------
  async function readWorkoutsFromHealth(sinceDate) {
    var plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
    var Health = plugins.Health;
    if (!Health) {
      throw new Error('Health plugin unavailable. Run a real iPhone build, not the browser.');
    }

    await Health.requestHealthPermissions({
      permissions: ['READ_WORKOUTS', 'READ_DISTANCE', 'READ_HEART_RATE']
    });

    var res = await Health.queryWorkouts({
      startDate: sinceDate.toISOString(),
      endDate: new Date().toISOString(),
      includeHeartRate: true
    });

    var raw = res.workouts || res.result || res || [];
    return raw.map(function (w) {
      var start = new Date(w.startDate || w.start);
      var end = w.endDate ? new Date(w.endDate) : null;
      var duration = Number(
        w.duration != null ? w.duration :
        w.totalDuration != null ? w.totalDuration :
        (end ? (end - start) / 1000 : 0)
      );
      return {
        start: start,
        modality: modalityOf(w.workoutType || w.type || w.activityType),
        distance: Number(w.distance != null ? w.distance : (w.totalDistance || 0)), // metres
        duration: duration,                                                          // seconds
        avgHr: Number(w.heartRateAvg || w.avgHeartRate || w.heartRate || 0)
      };
    });
  }
  // ------------------------------------------------------------------------

  function buildSessionIndex() {
    var idx = [];
    APP.PLAN.weeks.forEach(function (wk) {
      wk.sessions.forEach(function (s, i) {
        var group = null;
        if (RUN_TYPES.indexOf(s.t) > -1) group = 'run';
        else if (s.t === 'bike') group = 'bike';
        if (!group) return;
        idx.push({ id: APP.sid(wk.n, i), date: sessionDate(wk.n, s.d), group: group, title: s.title });
      });
    });
    return idx;
  }

  async function syncHealth() {
    var btn = document.getElementById('healthSyncBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }

    try {
      var sessions = buildSessionIndex();
      var earliest = sessions.reduce(function (m, s) { return s.date < m ? s.date : m; }, new Date());
      var since = new Date(Math.min(earliest.getTime(), Date.now() - 120 * MS_DAY));

      var workouts = await readWorkoutsFromHealth(since);
      var matched = 0;

      workouts.forEach(function (w) {
        if (w.modality === 'other') return;
        var cand = sessions.find(function (s) {
          return s.group === w.modality && sameDay(s.date, w.start);
        });
        if (!cand) return;

        var id = cand.id;
        APP.progress.actuals[id] = APP.progress.actuals[id] || {};
        var pace = paceFrom(w.distance, w.duration);
        if (pace) APP.progress.actuals[id].pace = pace;
        if (w.avgHr) APP.progress.actuals[id].hr = Math.round(w.avgHr) + ' bpm';
        APP.progress.done[id] = true;

        if (!APP.progress.notes[id]) {
          var km = (w.distance / 1000).toFixed(2);
          APP.progress.notes[id] = 'Auto from Apple Health: ' + km + ' km' +
            (w.avgHr ? (', ' + Math.round(w.avgHr) + ' bpm avg') : '');
        }
        matched++;
      });

      APP.saveProgress();
      APP.render();
      alert(matched + ' workout' + (matched === 1 ? '' : 's') + ' synced from Apple Health.');
    } catch (e) {
      alert('Health sync failed: ' + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sync Apple Health'; }
    }
  }

  // expose for manual calls and inject a button into the Analytics view
  window.syncHealth = syncHealth;

  function injectButton() {
    if (document.getElementById('healthSyncBtn')) return;
    var host = document.querySelector('.app-view-analytics') || document.body;
    var b = document.createElement('button');
    b.id = 'healthSyncBtn';
    b.textContent = 'Sync Apple Health';
    b.style.cssText = 'width:100%;padding:13px;margin:14px 0;border-radius:10px;' +
      'border:1px solid #3FA686;background:#0F6E56;color:#fff;font-weight:600;' +
      'font-family:inherit;font-size:0.85rem;cursor:pointer';
    b.addEventListener('click', syncHealth);
    host.prepend(b);
  }

  if (document.readyState !== 'loading') injectButton();
  else document.addEventListener('DOMContentLoaded', injectButton);
})();
