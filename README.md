# Joe-E Access Request Portal

This static site is hosted by GitHub Pages and is only for public Joe-E access requests. Internal IT support and onboarding forms remain in the on-premises HelpDesk app.

## Firebase setup

The portal uses the Firebase web client configuration in `config.js`; it contains no server credentials. Enable **Email link (passwordless sign-in)** in Firebase Authentication and add `pivotalstjoecmh-mb.github.io` to the project's authorized domains.

Requesters must open a Firebase sign-in link sent to their email before the form is enabled. The verified email must also match an active requester entry in Firestore. Active company names and only the signed-in requester's directory entry are readable by the browser.

The portal creates documents directly in the `tickets` collection. `firestore.rules` allows only correctly shaped Joe-E ticket creation from a verified account whose email matches the approved requester. It denies public reads, updates, and deletes, as well as access to all other collections. Staff maintain the private requester and company directory through the on-prem staff interface.

Before publishing, deploy the rules from the HelpDesk project root:

```powershell
firebase deploy --only firestore:rules --project helpdeskticket-11673
```

Then push this repository's root to the `main` branch and configure GitHub Pages to deploy from that branch's root. The public URL will be `https://pivotalstjoecmh-mb.github.io/HelpDeskTicket/`.

Direct Firestore submissions require no on-prem API or paid Cloud Functions plan. They do not trigger staff email notifications; staff see requests in the on-prem ticket queue. Keep a billing alert on the Firebase project and monitor Authentication/Firestore usage.
