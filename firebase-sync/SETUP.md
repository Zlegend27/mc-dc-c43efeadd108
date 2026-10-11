# Connecting the app to a shared, live team backend

This makes today's sales, the team checklist, the contact list, and a few shared settings
live across every phone using the app — if you mark the 1pm check done, your teammates see
it within a couple seconds, and vice versa. Uses Firebase, a free Google service built for
exactly this. Takes about 10 minutes, done once.

## 1. Create the project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign
   in with a Google account.
2. Click **Add project**. Name it anything (e.g. "district-texter"). When asked about
   Google Analytics, you can turn it off — not needed here.
3. Click **Create project**, then **Continue** once it's ready.

## 2. Turn on the database

1. In the left sidebar, under **Build**, click **Firestore Database**.
2. Click **Create database**.
3. Pick a location close to your stores (any US region is fine) and click **Next**.
4. Choose **Start in production mode**, then **Create**.

## 3. Turn on sign-in (no passwords involved)

1. In the left sidebar, under **Build**, click **Authentication**.
2. Click **Get started**.
3. Click **Anonymous** in the list of sign-in methods, toggle it **Enable**, click **Save**.
   (This lets the app quietly verify "this is one of our devices" without anyone typing
   a password — nobody sees a login screen.)

## 4. Lock it down to just this app

1. Back in **Firestore Database**, click the **Rules** tab.
2. Replace everything in the box with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /days/{dateId} {
         allow read, write: if request.auth != null;
       }
       match /roster/{docId} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
3. Click **Publish**.

   The `roster` block also covers the version history (`roster/history`) and the shared
   settings (`roster/settings`) — no extra rules are needed for those.

## 5. Get your app's connection details

1. Click the gear icon (top left, next to "Project Overview") → **Project settings**.
2. Scroll down to **Your apps**. Click the **</>** (web) icon.
3. Give it any nickname (e.g. "district-texter-web"), click **Register app** — skip the
   hosting step, just click **Continue to console**.
4. You'll see a block of code with a `firebaseConfig` object that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "district-texter-xxxxx.firebaseapp.com",
     projectId: "district-texter-xxxxx",
     storageBucket: "district-texter-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```
5. The six values go into `FIREBASE_CONFIG` near the top of `sync.js`, and cross-device
   sync turns on right away for everyone. (These values identify your project; they are
   not passwords and are safe to be public. Access is controlled by the rules in step 4.)

## What lives where

| Where | What | Notes |
|---|---|---|
| `days/<date>` | today's sales, who updated them and when, the checklist, who was texted | one document per day |
| `roster/current` | stores and staff | every edit is a small transaction, so a phone with an old copy can't overwrite a teammate's change |
| `roster/history` | the last 10 versions of the roster | Contacts → Earlier versions → Restore |
| `roster/settings` | LY, AOV, store hours, store time zones, hidden stores | shared by everyone |

**Stays on each phone on purpose:** message wording (openers, closers, low sales), the
minimum-goal numbers, the low-sales threshold, light/dark choice, and your name.

## What this does and doesn't do

- The staff contact list lives here, not in the public source files, so phone numbers
  aren't sitting in plain text in the GitHub repo.
- If the connection drops, edits are kept on the phone and sent when it's back. The badge
  says what's actually happening: **Live**, **Saving…**, **Offline — saved on this phone**,
  or **Sync problem** (tap it to retry).
- If this is ever misconfigured, or Firebase can't be reached, every phone goes back to
  working entirely on its own.

## The honest limit of the default setup

"Anonymous sign-in" means anyone who opens the app automatically satisfies the security
rule — it is not a login tied to a person. Someone who finds your app's link, or copies the
public Firebase values out of the page, could open the app (or a copy of it) and read or
edit this same data. For a small trusted team on an unlisted link that's a reasonable
trade-off. If you want it locked down, use the next section.

## Stronger protection (optional): one shared team passcode

This turns the open door into a locked one: phones sign in to one shared team account with a
passcode, and the database refuses everyone else.

1. **Authentication → Sign-in method:** enable **Email/Password**.
2. **Authentication → Users → Add user:** pick any email-shaped name you control (for example
   `team@yourdistrict.example` — it never receives mail) and set the **passcode** as the
   password (6+ characters).
3. In `sync.js`, set `TEAM_AUTH = { enabled: true, email: 'team@yourdistrict.example' }`,
   run `node scripts/stamp-build.mjs`, and publish.
4. Each phone asks for the passcode once, the first time it opens the new version. Wait until
   everyone has done that.
5. **Only then** replace the rules with the locked-down version (swap in your email):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isTeam() {
         return request.auth != null && request.auth.token.email == 'team@yourdistrict.example';
       }
       match /days/{dateId}   { allow read, write: if isTeam(); }
       match /roster/{docId}  { allow read, write: if isTeam(); }
     }
   }
   ```
6. Optional: turn **Anonymous** sign-in off.

Doing step 5 before everyone has entered the passcode just leaves those phones working on
their own until they do — nothing is lost — but it will look like sync is broken.
