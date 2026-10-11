# District Texter

A phone-first web app for the district's daily texting routine: openers, closers, low-sales
checks, and the team checklist. Static site (no build step) hosted on GitHub Pages, with
live team sync through Firebase. Setup for the shared backend is in
[firebase-sync/SETUP.md](firebase-sync/SETUP.md).

## Files

| File | What it is |
|---|---|
| `index.html` | page structure |
| `style.css` | all styling (light/dark, mobile + desktop) |
| `lib.js` | pure logic: report parsing, names, phone formatting, goal math, time zones, roster edits. Unit-tested. |
| `sync.js` | Firebase connection, connection status, offline queue (ES module) |
| `app.js` | the app itself: screens, state, wiring |
| `sw.js`, `manifest.webmanifest`, `assets/` | offline support and Home Screen install |
| `opener-texter.html` | redirect so old Home Screen shortcuts keep working |
| `scripts/` | dev tooling (below), plus `sling-sync.mjs` / `sling-lib.mjs` which copy the Sling schedule into Firebase (run by `.github/workflows/sling-sync.yml`) |

## Working on it

```
node serve.mjs              # local server on http://localhost:8731
node scripts/check.mjs      # tests (must say 0 failed)
node scripts/stamp-build.mjs   # REQUIRED before committing any change to the served files
```

`stamp-build.mjs` updates the `?v=` build stamp in `index.html`, the `build-date` meta, and the
service-worker version. Without it phones can keep an old copy of a changed file. `check.mjs`
fails if the stamp is stale.

### Sandbox mode

To try things against Firebase without touching the team's real data, run this in the browser
console on your local copy, then reload:

```js
localStorage.setItem('districtTexter.ns', 'qa1-')
```

Every document the app reads and writes gets that prefix (`days/qa1-…`, `roster/qa1-…`).
Remove it with `localStorage.removeItem('districtTexter.ns')`. Test documents can be deleted
in the Firebase console.

## Data model

- `days/<date>` — today's sales (with per-store timestamps), report info, checklist, who was texted.
- `roster/current` — stores and staff. Edited by small per-person/per-store transactions.
- `roster/history` — last 10 roster versions (Contacts → Earlier versions).
- `roster/settings` — LY, AOV, store hours, store time zones, hidden stores.
- `roster/schedule` — the next few days of Sling shifts in store-local time, written by the Sling job and read-only in the app.

Message wording, minimum goals, the low-sales threshold, theme and name stay on each phone on
purpose.

## Things to know

- Never commit real phone numbers or names to this repo — it's public. Contacts live in
  Firestore only; `check.mjs` fails if a phone-shaped number appears in a served file.
- The Firebase web config in `sync.js` is not a secret; the database rules are what protect data.
- Optional hardening (shared team passcode) is described in `firebase-sync/SETUP.md`.
