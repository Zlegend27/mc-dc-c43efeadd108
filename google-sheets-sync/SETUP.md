# Connecting the app to your Google Sheet

This makes the roster sheet the source of truth: the app reads it when it opens, and
every edit you make in the app's Contacts tab writes straight back. Takes about 10
minutes, done once, by whoever manages the Google Sheet.

## 1. Paste in the script

1. Open your roster Google Sheet.
2. Click **Extensions → Apps Script**.
3. Delete anything in the editor (there may be an empty `function myFunction() {}`).
4. Open [Code.gs](Code.gs) in this folder, copy everything in it, and paste it into the
   Apps Script editor.
5. Click the **Save** icon (or `Ctrl+S`).

## 2. Run setup once

1. At the top of the Apps Script editor, next to the **Run** button, there's a dropdown
   of functions — choose **setup**.
2. Click **Run**. The first time, Google will ask you to authorize it — click through
   (**Review permissions → your account → Advanced → Go to \[project name\] (unsafe) →
   Allow**). This warning is normal for scripts you write yourself; it's just Google
   being cautious about a script that can edit your sheet.
3. Click **View → Logs** (or `Ctrl+Enter`). You'll see a line like:
   `Your secret sync key (copy this into the app once): 3f9a1c2b-...`
4. Copy that key somewhere safe — send it back so it can be added to the app.
5. Check your Sheet — a new tab called **Store Hours** should have appeared, with a
   `DEFAULT` row already filled in (8pm Mon–Thu, 9pm Fri & Sat, 7pm Sun). Add a row for
   any specific mall whose hours are different — leave every other mall out and it just
   uses the default.

## 3. Deploy it as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
   (This does *not* make your sheet public — it only exposes the specific read/write
   actions this script defines, and writes still require the secret key from step 2.)
4. Click **Deploy**, authorize again if asked.
5. Copy the **Web app URL** it gives you (ends in `/exec`) — send that back too.

## 4. That's it

Send back the **Web app URL** and the **secret key** from step 2 — those get pasted
into two lines near the top of the app (`SHEETS_ENDPOINT` and `SHEETS_KEY`), and from
then on the app and the sheet stay in sync automatically.

## If you ever change something and it stops working

Apps Script deployments are versioned — if you edit `Code.gs` again later, you need to
**Deploy → Manage deployments → edit (pencil) → New version → Deploy** for the changes
to actually take effect. The Web app URL stays the same.

## What this script can and can't do

- It only touches your roster tab and the **Store Hours** tab it creates — nothing else
  in the spreadsheet.
- Writes require the secret key; anyone without it can only read the roster, not change it.
- Every change is still visible in the Sheet's own version history (**File → Version
  history**), so any mistake — from the app or otherwise — is one click to undo.
