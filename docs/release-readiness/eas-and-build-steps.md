# EAS and build steps (owner)

Nothing here was run in the cloud container: no EAS command, no build, no upload. Commands are run by the owner from `apps/mobile` on their own machine, logged in with `npx eas-cli login`.

## What the repository guarantees (verified here)

| Check | Where | Verified here |
|---|---|---|
| Package `com.jovo.app`, version `0.17.0`, versionCode 17 consistent between `app.json` and the hand-maintained `android/` | `scripts/check-native-config.cjs` | Ran: OK |
| `ACCESS_BACKGROUND_LOCATION` kept; 8 granted / 5 blocked permissions; `expo-camera` absent | same | Ran: OK |
| A **production**-profile build stops unless `EXPO_PUBLIC_API_URL` is exactly `https://api.jovops.com` (`eas-build-pre-install`) | `scripts/check-release-env.cjs` | Ran: `check-release-env.test.cjs` 3/3 (unset, http, ngrok, staging and look-alike hosts refused) |
| Release bundles refuse HTTP, ngrok, localhost and private hosts at startup | `src/core/api-url.ts` (+ test) | Ran in the mobile unit suite |
| Firebase is applied only when `google-services.json` is provided | `scripts/install-google-services.cjs`, Gradle conditionals | Ran: 3/3; Gradle itself not run |
| `eas.json`: `appVersionSource: remote` with `autoIncrement` on production, so EAS owns the versionCode on store builds (the `app.json` value is the starting point). `preview` builds an APK for side-loading; `production` builds an AAB. | `eas.json` | Read |

## 1. One-time EAS environment (production)

```bash
eas env:list --environment production
```

```bash
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.jovops.com --visibility plaintext
```

Optional, only when decided (see `owner-action-items.md`):

```bash
eas env:create --environment production --name EXPO_PUBLIC_ERROR_REPORT_URL --value <https ingest url> --visibility plaintext
```

```bash
eas env:create --environment production --name EXPO_PUBLIC_MAP_TILE_URL --value <licensed https tile template> --visibility plaintext
```

```bash
eas env:create --environment production --name EXPO_PUBLIC_MAP_TILE_ATTRIBUTION --value "<provider attribution>" --visibility plaintext
```

Remove the variable that is no longer read, if it exists:

```bash
eas env:delete --environment production --name EXPO_PUBLIC_GEOCODER_URL
```

Also replace the ngrok value in your local, untracked `apps/mobile/.env.production`.

## 2. Firebase (Android push)

1. Firebase console → add Android app `com.jovo.app` → download `google-services.json` (keep it out of git; `android/app/google-services.json` is ignored).
2. Store it as an EAS file variable:
   ```bash
   eas env:create --environment production --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret
   ```
3. Firebase → Project settings → Service accounts → Generate new private key. Upload it for FCM V1:
   ```bash
   eas credentials --platform android
   ```
   (choose production → Google Service Account → FCM V1). Never commit this key.

## 3. Lockfile (L1), before the first build

From the repository root:

```bash
npm install
```

Check that only `expo-camera` entries left `package-lock.json`, then commit.

## 4. First AAB

```bash
eas build --platform android --profile production
```

Expected in the build log: `[check-release-env] OK` and `[google-services] installed for com.jovo.app` (or the "building without Firebase" line if step 2 was skipped). Download the `.aab` and check the merged manifest (L5):

```bash
bundletool dump manifest --bundle app-release.aab
```

Confirm `ACCESS_BACKGROUND_LOCATION` and `FOREGROUND_SERVICE_LOCATION` are present, `CAMERA` is not, and check whether `POST_NOTIFICATIONS` was merged in by `expo-notifications` (UNVERIFIED here: it is not in the checked-in manifest).

## 5. Play Console: internal testing, then closed testing

1. Create the app (default language Arabic), package `com.jovo.app`. Enrol in Play App Signing.
2. **The first AAB must be uploaded by hand** in Testing → Internal testing → Create release. Later releases can use `eas submit --platform android --profile production` after a Play service account is configured in EAS (not configured in this repository).
3. Add testers (internal list), roll out, install from the opt-in link, run the device tests in `remaining-work.md` R35.
4. Promote to Closed testing when the tests pass. Check the console for the current tester-count and test-duration requirements for your account type before planning production.

## 6. Play Console declarations (text in `docs/store/`)

| Form | Source |
|---|---|
| App access (demo credentials + instructions) | `docs/store/review-notes.md` (Arabic and English) and the demo accounts (`reviewer-access-guide.md`) |
| Data safety | `docs/store/data-safety-and-app-privacy.md` |
| Location permissions (background) + ≤30 s video | `docs/store/play-console-declarations.md`; video from the device test in `technical-analyses.md#h8-run2` |
| Foreground service (location) | `docs/store/play-console-declarations.md` |
| Privacy policy URL | `https://jovops.com/privacy` (must be live) |
| Account deletion URL | `https://jovops.com/delete-account` (must be live) |
| Content rating, target audience (P9), ads (none), news (no) | answer in the console |
| Store listing | `docs/store/store-listing.md`; all placeholders in `docs/store/PLACEHOLDERS.md` |

## 7. iOS (after Apple enrollment)

```bash
eas build --platform ios --profile production
```

Then App Store Connect: App Privacy (from `data-safety-and-app-privacy.md`), review notes (`docs/store/review-notes.md`), demo accounts, privacy and support URLs. No iOS build has ever been produced; expect a first-build fix-up round.
