"""Re-apply the android/ settings that `expo prebuild` resets.

`expo prebuild --clean` regenerates android/ from the Expo template, which
silently drops three deliberate choices that have no app.json equivalent. Run
this after every prebuild, or the next release build will quietly lose them.

Adopting `expo-build-properties` would let the gradle.properties values live in
app.json and survive prebuild on their own; the release signingConfig would
still need this script.
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.normpath(os.path.join(HERE, "..", "android"))


def patch(path, edits):
    """Apply (marker, old, new) edits, skipping any already applied.

    `marker` is what the file looks like once the edit has landed. Checking it
    first keeps the script idempotent even when `old` is a substring of `new`,
    which is the case for the inserted gradle.properties lines.
    """
    full = os.path.join(ANDROID, path)
    text = io.open(full, encoding="utf-8").read()
    for marker, old, new in edits:
        if (marker in text) if new else (marker not in text):
            continue
        if old not in text:
            raise SystemExit(
                "post-prebuild: pattern not found in %s:\n%s" % (path, old)
            )
        text = text.replace(old, new)
    io.open(full, "w", encoding="utf-8", newline="\n").write(text)
    print("patched", path)


# R8 and resource shrinking stay on for release; the dev-client network
# inspector stays off so a dev build cannot expose request traffic.
patch(
    "gradle.properties",
    [
        (
            "android.enableMinifyInReleaseBuilds=true",
            "android.enablePngCrunchInReleaseBuilds=true\n",
            "android.enablePngCrunchInReleaseBuilds=true\n"
            "android.enableMinifyInReleaseBuilds=true\n"
            "android.enableShrinkResourcesInReleaseBuilds=true\n",
        ),
        (
            "EX_DEV_CLIENT_NETWORK_INSPECTOR=false",
            "EX_DEV_CLIENT_NETWORK_INSPECTOR=true",
            "EX_DEV_CLIENT_NETWORK_INSPECTOR=false",
        ),
    ],
)

# A release APK must not be signed with the checked-in debug keystore.
RELEASE_DEBUG_SIGNING = (
    "            // Caution! In production, you need to generate your own keystore file.\n"
    "            // see https://reactnative.dev/docs/signed-apk-android.\n"
    "            signingConfig signingConfigs.debug\n"
)
patch("app/build.gradle", [(RELEASE_DEBUG_SIGNING, RELEASE_DEBUG_SIGNING, "")])
