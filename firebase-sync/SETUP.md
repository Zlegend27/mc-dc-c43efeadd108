# Connecting the app to a shared, live team backend

This makes today's sales entries and the team checklist shared live across every
phone using the app — if you mark the 1pm check done, your teammates see it within
a couple seconds, and vice versa. Uses Firebase, a free Google service built for
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

   (If you already set this up before contacts moved to Firestore, you likely only have
   the `days` block — add the `roster` block too and re-publish, or nothing involving
   staff/contacts will sync.)

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
5. Copy those six values (or just paste the whole block) back — they go into one spot
   near the top of the app, and cross-device sync turns on right away for everyone.

## What this does and doesn't do

- Today's sales, the shared checklist, **and the staff contact roster** (names, phone
  numbers) all live here now — moved out of the app's public source file specifically so
  real staff phone numbers aren't sitting in plain text in the public GitHub repo anymore.
- Nobody needs an account, a password, or to sign into anything — the app handles it
  silently in the background.
- If this is ever misconfigured or you want to turn sync off, just clear the six values
  back to blank — every device goes back to working entirely on its own, exactly like
  before this feature existed. Note that turning it off doesn't bring the roster back
  into the public file automatically — talk to whoever set this up before turning it off
  if the team is actively relying on it.

## The honest limit of this setup

"Anonymous sign-in" means anyone who opens the app automatically satisfies the security
rule above — it's not the same as a real login tied to a specific person. In practice
that means: someone who finds your app's link, or copies its public Firebase connection
details out of the page source, could open the app (or a copy of it) and read or edit
this same data, the same way your team does. It's a real step up from the old setup
(the phone numbers no longer show up just from browsing the GitHub repo or its history),
but it isn't the same as data locked to only your team's named accounts. For a small
trusted team on an unlisted link, this is a reasonable trade-off — if you ever want
stronger protection (a real login screen, one account per person), that's a bigger
follow-up project, not a quick setting to flip.
