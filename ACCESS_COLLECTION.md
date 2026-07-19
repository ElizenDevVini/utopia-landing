# collecting access requests safely (no backend, unblockable)

Form services (Formspree etc.) block crypto solicitation, so requests go to a
Google Apps Script web app you own instead. Free, private, can't be ToS-blocked,
and no secret ends up in the site code.

## setup (about 5 minutes)

1. Make a new Google Sheet. Add a header row: `wallet`, `utopiaHeld`, `at`.
2. Extensions → Apps Script. Replace the code with:

```js
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()
    .appendRow([d.wallet, d.utopiaHeld, new Date(d.at)]);
  return ContentService.createTextOutput('ok');
}
```

3. Deploy → New deployment → type "Web app" → Execute as: **Me** → Who has
   access: **Anyone** → Deploy. Copy the web-app URL (ends in `/exec`).
4. Paste that URL into `ACCESS_WEBHOOK` in `app.js`, commit, redeploy the site.

## how it works

When an unapproved wallet clicks "request access to buy," the site POSTs
`{ wallet, utopiaHeld, at }` to your web app, which appends a row to your Sheet.
Sort the Sheet by `utopiaHeld` descending to approve the biggest holders first.
It also copies the address to the user's clipboard and points them to your X as
a fallback, so nothing is lost if the POST ever fails.

## approving

Take the wallets you want from the Sheet and run:

```sh
cd contracts
./batch-enroll.sh 0xWallet1 0xWallet2 ...
```

Paste the printed calldata into your Safe (To: eligibility registry, Value: 0),
sign, execute. Approved wallets can then buy.
