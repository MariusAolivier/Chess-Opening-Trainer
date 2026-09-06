# Chess Opening trainer

### Remember 

- branches of less than 3 moves with no forks inside are classified as sidelines
- sidelines get tagged along their parent variations, and detoured in the training session
- chapters starting with "***" are themes and begin training from the chapter start position
- lichess studies starting with "/" are ignored

## Cloud sync setup

Cloud sync uses Firebase Authentication and stores every account under its own
`users/{uid}` Firestore path.

1. Enable the Google provider in Firebase Authentication.
2. Add the deployed GitHub Pages hostname to Authentication's authorized domains.
3. Deploy the checked-in rules with `firebase deploy --only firestore:rules`.
