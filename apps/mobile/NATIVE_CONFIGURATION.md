# Native configuration ownership

The mobile application intentionally uses a mixed Expo setup:

- **Android is a checked-in, hand-maintained native project.** Files under `android/` are authoritative for the binary. `app.json` remains the shared source for values used by Expo tooling, so critical duplicated values are gated by `npm run check:native-config`.
- **iOS uses Continuous Native Generation.** There is no checked-in `ios/` directory; Expo/EAS generates it from `app.json` and config plugins. If an iOS directory is ever committed, the consistency check deliberately fails until equivalent native assertions are added.

Because Android is maintained rather than regenerated for every build, the Expo Doctor `appConfigFieldsNotSyncedCheck` opt-out is intentional and is retained. Removing it would report expected differences and would not make `app.json` authoritative over the existing Android project.

## Critical synchronization map

| Setting | Expo source | Android authority |
| --- | --- | --- |
| Package/namespace | `android.package` | `app/build.gradle` and Kotlin package path/declarations |
| App/version baseline | `name`, `version`, `android.versionCode` | resources and `app/build.gradle`; EAS production build numbers remain remote/auto-incremented |
| Deep-link schemes | `scheme` | `AndroidManifest.xml` (`jovo` and Expo development-client scheme) |
| Permissions | `android.permissions`, `android.blockedPermissions`, config plugins | `AndroidManifest.xml`; Camera/Internet/Vibrate are plugin/runtime requirements, while audio/storage/overlay remain removed |
| Expo Updates | `updates`, `runtimeVersion`, EAS project ID | `AndroidManifest.xml` metadata |
| Release channel | production profile `channel` | production request header in `AndroidManifest.xml` |
| New architecture | `newArchEnabled` | `gradle.properties` |
| Notification channel | runtime Push setup | `src/core/push-notifications.ts` (`orders`, high importance) |

`check:native-config` also protects the native-only release choices that a standard prebuild removes: release minification/resource shrinking, no debug signing for release, and a disabled development-client network inspector.

## Safe update workflow

1. Change `app.json` and the maintained Android files together when a mapped value changes.
2. Run `npm run check:native-config --workspace @wasel/mobile` and Expo Doctor.
3. To compare current CNG output, copy the Mobile project to a temporary directory and run `expo prebuild --platform android --no-install --clean` there. Do not run a clean prebuild over the maintained project merely for comparison.
4. If Android is intentionally regenerated, review the entire native diff, run `python scripts/post-prebuild.py`, rerun the consistency check, and verify an unsigned Android build. Never accept the template's release debug signing.

The production channel is the checked-in Android default. Preview/development native builds must use the corresponding channel during their build process; do not manually ship the production manifest as a preview binary without confirming the embedded update request header.
