/*
 * datum-sync.js  (web)
 * Fills the Sub-20 plan with your real sessions from datum_health.json.
 *
 * Reuses the proven matching from health-sync: a workout is matched to a plan
 * session when it falls on the same calendar day and the same group (run / bike /
 * strength). The only change versus the native version is the source: here we read
 * the JSON the Python extractor produces, fetched from the same folder as the page.
 *
 * Non-destructive: a session you logged by hand is never overwritten. Auto entries
 * are tagged so a re-sync only refreshes its own writes.
 */
(function () {
  'use strict';

  var APP = window.SUB20;
  if (!APP) { console.warn('[datum-sync] SUB20 bridge missing'); return; }

  var DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MS = 86400000;
  var RUN_TYPES = ['quality', 'easy', 'long', 'trial', 'race'];

  function sessionDate(n, dn) {
    var i = DAY.indexOf(dn); if (i < 0) i = 0;
    var d = new Date(APP.PLAN_START_DATE.getTime() + ((n - 1) * 7 + i) * MS);
    d.setHours(0, 0, 0, 0); return d;
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function paceFrom(m, s) {
    if (!m || !s) return '';
    var km = m / 1000; if (km < 0.4) return '';
    var p = s / km, mm = Math.floor(p / 60), ss = Math.round(p % 60);
    if (ss === 60) { mm++; ss = 0; }
    return mm + ':' + (ss < 10 ? '0' + ss : ss) + '/km';
  }
  function planGroup(t) {
    if (RUN_TYPES.indexOf(t) > -1) return 'run';
    if (t === 'bike') return 'bike';
    if (t === 'strength') return 'strength';
    return null;
  }
  function healthGroup(m) {
    if (m === 'run') return 'run';
    if (m === 'bike') return 'bike';
    if (m === 'strength' || m === 'crosstrain' || m === 'hiit') return 'strength';
    return null;
  }

  function planIndex() {
    var a = [];
    APP.PLAN.weeks.forEach(function (wk) {
      wk.sessions.forEach(function (s, i) {
        var g = planGroup(s.t); if (!g) return;
        a.push({ id: APP.sid(wk.n, i), date: sessionDate(wk.n, s.d), group: g });
      });
    });
    return a;
  }

  function normalise(data) {
    return (data.workouts || []).filter(function (w) { return w.trusted; }).map(function (w) {
      return {
        date: new Date(w.date + 'T12:00:00'),     // local noon avoids date drift
        group: healthGroup(w.modality),
        distance: w.distance_m || 0,
        duration: w.duration_s || 0,
        hr: w.hr_avg || 0
      };
    }).filter(function (w) { return w.group; });
  }

  function fill(workouts) {
    var p = APP.progress;
    p.done = p.done || {}; p.actuals = p.actuals || {}; p.notes = p.notes || {}; p.auto = p.auto || {};
    var matched = 0;
    planIndex().forEach(function (slot) {
      var cands = workouts.filter(function (w) { return w.group === slot.group && sameDay(w.date, slot.date); });
      if (!cands.length) return;
      cands.sort(function (a, b) { return slot.group === 'run' ? (b.distance - a.distance) : (b.duration - a.duration); });
      var w = cands[0];
      if (p.done[slot.id] && !p.auto[slot.id]) return;   // respect a manual log
      p.actuals[slot.id] = p.actuals[slot.id] || {};
      var pace = paceFrom(w.distance, w.duration);
      if (pace) p.actuals[slot.id].pace = pace;
      if (w.hr) p.actuals[slot.id].hr = Math.round(w.hr) + ' bpm';
      p.done[slot.id] = true; p.auto[slot.id] = true;
      if (!p.notes[slot.id]) {
        var km = w.distance / 1000;
        p.notes[slot.id] = 'From Datum' + (km >= 0.4 ? ': ' + km.toFixed(2) + ' km' : '') + (w.hr ? ', ' + Math.round(w.hr) + ' bpm' : '');
      }
      matched++;
    });
    APP.saveProgress(); APP.render();
    return matched;
  }

  function banner(n) {
    var host = document.querySelector('.app-view-analytics') || document.body;
    var el = document.getElementById('datumSync');
    if (!el) { el = document.createElement('div'); el.id = 'datumSync'; host.prepend(el); }
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;' +
      'margin:14px 0;padding:11px 14px;border-radius:11px;border:1px solid #3FA68655;' +
      'background:rgba(63,166,134,0.10);color:#cfe9df;font-size:0.8rem';
    el.innerHTML = '<span><b style="color:#fff">' + n + '</b> session' + (n === 1 ? '' : 's') +
      ' auto-filled from your data</span>' +
      '<button id="datumResync" style="border:1px solid #3FA686;background:#0F6E56;color:#fff;' +
      'border-radius:8px;padding:6px 12px;font:inherit;font-size:0.74rem;cursor:pointer">Re-sync</button>';
    var btn = el.querySelector ? el.querySelector('#datumResync') : null;
    if (btn) btn.onclick = run;
  }

  function run() {
    return fetch('datum_health.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { banner(d ? fill(normalise(d)) : 0); })
      .catch(function (e) { console.warn('[datum-sync]', e); });
  }

  window.DATUM_SYNC = { run: run, fill: fill, normalise: normalise };

  if (typeof fetch === 'function') {
    if (document.readyState !== 'loading') run();
    else document.addEventListener('DOMContentLoaded', run);
  }
})();
