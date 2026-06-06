# Datum Training · iOS app from a Windows machine

Datum Training is a 28-week sub-20 5K tracker, packaged as a native iOS app with Apple Health sync.
The whole thing is developed on Windows. The native compile and signing happens on
a cloud Mac, because Apple ships Xcode for macOS only and there is no legitimate way
around that one step.

## What runs where

| Stage | Machine |
|---|---|
| Write code, edit web app, edit native config | Your Windows laptop |
| Web build (HTML, CSS, JS) | Windows, local |
| `npx cap add ios` (scaffold the ios/ folder) | Windows, local |
| Native compile, signing, archive, TestFlight upload | Cloud Mac |
| Test HealthKit | Your physical iPhone (Health data does not exist in the simulator) |

The loop once set up is push to GitHub, cloud builds, TestFlight gets the binary,
you install on your iPhone and test.

## One-off prerequisites

1. Apple Developer Program membership, about £79 a year. Required for the HealthKit
   entitlement and for TestFlight. This is the only hard cost.
2. An iPhone (you already have one, since Apple Health is iPhone only).
3. A GitHub account.
4. A cloud build account. Pick one:
   - Capgo Build, made for exactly this Windows to iOS flow.
   - Capawesome Cloud, isolated macOS build environments, fast turnaround.
   - Xcode Cloud, Apple own service, free up to a monthly limit.
5. Node.js LTS installed on Windows. Get it from nodejs.org.

## Project layout (this folder)

```
datum/
  www/
    index.html        your tracker (already wired for sync)
    health-sync.js    reads Apple Health workouts, writes them into the plan
  capacitor.config.json
  package.json
  README.md
```

`www/index.html` already has two edits applied versus your original upload:

- A bridge line near the end that exposes the app internals on `window.SUB20`
  so the separate sync file can read and write the plan and progress.
- A `<script src="health-sync.js">` tag before the closing body tag.

## Step 1 · Set up on Windows

Open a terminal in this folder and run:

```
npm install
npx cap add ios
```

`cap add ios` is pure file generation, so it runs fine on Windows. It creates an
`ios/` directory holding the Xcode project. Commit that directory to git. The cloud
builder compiles exactly what is inside `ios/`, so it must be versioned.

Every time you change the web app afterwards:

```
npx cap copy ios
```

then commit and push.

## Step 2 · HealthKit configuration

These files live inside the generated `ios/` folder and are plain text, so you edit
them on Windows.

1. Entitlement. In `ios/App/App/App.entitlements` add the HealthKit capability:

```xml
<key>com.apple.developer.healthkit</key>
<true/>
```

2. Usage strings. In `ios/App/App/Info.plist` add the two keys iOS shows the user
   on the permission sheet:

```xml
<key>NSHealthShareUsageDescription</key>
<string>Datum Training reads your runs and rides to fill in actual paces against your plan.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Datum Training does not write to Health.</string>
```

3. App ID. In your Apple Developer account, enable the HealthKit capability on the
   App ID that matches `appId` in `capacitor.config.json` (`com.kenhaynes.datum`).
   Change that id to your own reverse-domain string before you start if you like.

## Step 3 · Cloud build and TestFlight

Connect your GitHub repo to your chosen cloud builder, point it at this project,
and trigger an iOS build. The service compiles on a real Mac, signs with your Apple
credentials, and uploads to TestFlight. From late April 2026 onward App Store
Connect requires builds made with Xcode 26 and the iOS 26 SDK. The cloud builders
already run that toolchain, so no action is needed from you.

With Capgo Build the trigger is a single CLI command from Windows, for example:

```
npx @capgo/cli app build ios
```

Check the current docs for your chosen service for the exact command and how to add
your Apple credentials as secrets.

## Step 4 · Test on the phone

Install the build from TestFlight on your iPhone. Open the app, go to the Analytics
tab, tap **Sync Apple Health**, and approve the permission sheet. Completed runs and
rides matched to the right day get their actual pace, average heart rate, and a tick
filled in automatically. The VDOT and projection logic you already built then reacts
to the new actuals.

HealthKit returns nothing in a browser or simulator, so the Sync button only does
real work on the device build. In the browser it reports that the plugin is
unavailable, which is expected.

## How the matching works

`health-sync.js` rebuilds each session date from `PLAN_START_DATE` (the Monday of
week 1) plus the week offset plus the day-of-week offset. Each Health workout is
tagged run or bike, then matched to the session on the same calendar day with the
same modality. Run types are quality, easy, long, trial and race. Bike sessions map
to cycling workouts. Strength and rest days are skipped.

## Swapping the health plugin

The only plugin-specific code is `readWorkoutsFromHealth()` in `health-sync.js`.
The default targets the `capacitor-health` plugin. To use a different one, rewrite
that function to call the new plugin and return the same normalised array of
`{ start, modality, distance, duration, avgHr }`. Nothing else changes.

## The honest limits

- You cannot fully build or submit without the cloud Mac step. That is an Apple
  constraint, not a tooling gap.
- HealthKit never grants silent access. The user approves each data type once.
- Read-on-tap is the reliable pattern. True background sync exists but is rate
  limited and not worth the complexity for a personal tracker.
