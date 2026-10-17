NAINIKA BAKES — Firebase private-login update

Included files:
- index.html: Firebase SDK/config + sign-in screen
- app.js: existing business logic preserved; local backup plus authenticated Firestore load/save
- style.css: original stylesheet copied unchanged
- firestore.rules.txt: owner-only Firestore rules template

IMPORTANT SETUP
1. Keep a copy of your current files and export a JSON backup before testing.
2. Replace your project index.html, app.js and style.css with these files (same folder).
3. Firebase Console > Authentication > Users: create/confirm your own account (Email/Password) or sign in with the Google account you enabled.
4. In Firestore Rules, paste firestore.rules.txt and replace OWNER_FIREBASE_UID with your own UID from Authentication > Users. Publish the rules. Until this is done, cloud read/write is expected to be denied.
5. Open the site via a web server (for example VS Code Live Server), not by double-clicking index.html.
6. Sign in. If Firestore has no existing document, current browser data is copied to your signed-in account on first successful connection. If cloud data exists, it replaces the local in-memory data and is cached locally.

SECURITY: Rules must be restricted to your own UID. Do not publish rules with unrestricted read/write access. Firebase web config is not a password; Firestore Rules and Authentication protect the records.
