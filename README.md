# Chess Opening trainer

### Remember 

- branches of less than 3 moves with no forks inside are classified as sidelines
- sidelines get tagged along their parent variations, and detoured in the training session
- chapters starting with "***" are themes and begin training from the chapter start position
- lichess studies starting with "/" are ignored

## Cloud sync setup

Cloud sync uses Firebase Authentication and stores every account under its own
`users/{uid}` Firestore path.

The checked-in Firestore rules restrict database reads and writes to the owner's
Firebase Authentication UID and that UID's own `users/{uid}` path. Other Google
accounts can still sign in, but cannot read or write Firestore data. To authorize
a different owner, update the UID in `firestore.rules` and redeploy the rules.

1. Enable the Google provider in Firebase Authentication.
2. Add the deployed GitHub Pages hostname to Authentication's authorized domains.
3. Deploy the checked-in rules with `firebase deploy --only firestore:rules`.

Google sign-in opens a pop-up directly from the button click and keeps the session
in persistent browser storage. The home page displays the signed-in email and
cloud-sync status separately. If sign-in is blocked, allow pop-ups for the site;
on mobile, use the same Safari/Chrome browser profile that contains your progress.
Do not clear site storage or sign out to troubleshoot unsynced local progress.

Progress conflicts are resolved by the last review time, not by a newly created
line's due date. Unreviewed lines cannot overwrite completed reviews from another
device, and legacy line IDs carry their review history into the current IDs.
Independently imported copies of the same study are merged, retaining redirect
metadata so progress attached to each device's original chapter IDs can migrate.
An expired or missing Google session does not clear local progress; only an
explicit sign-out or a switch to another account clears the account's local cache.

Sync uploads changed records rather than rewriting the entire repertoire.
Unchanged fork recommendations keep their original timestamps, repeated review
uploads do not increment activity twice, and live study updates reuse received
snapshots instead of querying all collections again. Initial loads and listener
attachments still consume reads; new or changed records consume writes.

Firestore's free daily allowance includes 50,000 document reads and 20,000
document writes. If Firebase reports quota exhaustion, the app stops its
listeners and further cloud requests for that account on the device for the
remainder of the Pacific quota day. The pause persists across reloads. Training
and local progress remain available; do not clear site storage or sign out.
Reload after the quota resets around midnight Pacific to resume reconciliation.
Code changes cannot restore already-consumed quota, and billing is not required
or automatically enabled.
