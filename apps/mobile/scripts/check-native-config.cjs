const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.resolve(__dirname, "..");
const androidRoot = path.join(mobileRoot, "android");
const app = require(path.join(mobileRoot, "app.json")).expo;
const eas = require(path.join(mobileRoot, "eas.json"));
const mobilePackage = require(path.join(mobileRoot, "package.json"));

function read(relativePath) {
  return fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capture(content, expression, label) {
  const match = content.match(expression);
  assert.ok(match, `Missing ${label}`);
  return match[1];
}

function metadataValue(manifest, name) {
  return capture(
    manifest,
    new RegExp(`<meta-data\\s+android:name="${regexEscape(name)}"\\s+android:value="([^"]*)"\\s*/>`),
    `Android metadata ${name}`
  );
}

function sorted(values) {
  return [...values].sort();
}

assert.ok(fs.existsSync(androidRoot), "The checked-in Android project is required");
assert.ok(!fs.existsSync(path.join(mobileRoot, "ios")), "An iOS directory now exists; extend this check before treating it as authoritative");
assert.equal(
  mobilePackage.expo?.doctor?.appConfigFieldsNotSyncedCheck?.enabled,
  false,
  "Expo Doctor's sync opt-out is intentional for the maintained Android project"
);

const gradle = read("android/app/build.gradle");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const strings = read("android/app/src/main/res/values/strings.xml");
const settings = read("android/settings.gradle");
const properties = read("android/gradle.properties");
const mainActivity = read(`android/app/src/main/java/${app.android.package.replaceAll(".", "/")}/MainActivity.kt`);
const mainApplication = read(`android/app/src/main/java/${app.android.package.replaceAll(".", "/")}/MainApplication.kt`);

assert.equal(capture(gradle, /namespace\s+['"]([^'"]+)['"]/, "Android namespace"), app.android.package);
assert.equal(capture(gradle, /applicationId\s+['"]([^'"]+)['"]/, "Android applicationId"), app.android.package);
assert.equal(Number(capture(gradle, /versionCode\s+(\d+)/, "Android versionCode")), app.android.versionCode);
assert.equal(capture(gradle, /versionName\s+"([^"]+)"/, "Android versionName"), app.version);
assert.match(mainActivity, new RegExp(`^package ${regexEscape(app.android.package)}$`, "m"));
assert.match(mainApplication, new RegExp(`^package ${regexEscape(app.android.package)}$`, "m"));
assert.match(settings, new RegExp(`rootProject\\.name = '${regexEscape(app.name)}'`));
assert.equal(capture(strings, /<string name="app_name">([^<]+)<\/string>/, "Android app name"), app.name);

assert.match(manifest, new RegExp(`android:allowBackup="${String(app.android.allowBackup)}"`));
assert.match(manifest, /android:screenOrientation="portrait"/);
assert.match(manifest, new RegExp(`<data android:scheme="${regexEscape(app.scheme)}"/>`));
assert.match(manifest, new RegExp(`<data android:scheme="exp\\+${regexEscape(app.scheme)}"/>`));

const permissionTags = [...manifest.matchAll(/<uses-permission\s+([^>]+)\/>/g)].map((match) => match[1]);
const grantedPermissions = permissionTags
  .filter((attributes) => !attributes.includes('tools:node="remove"'))
  .map((attributes) => capture(attributes, /android:name="([^"]+)"/, "permission name"));
const removedPermissions = permissionTags
  .filter((attributes) => attributes.includes('tools:node="remove"'))
  .map((attributes) => capture(attributes, /android:name="([^"]+)"/, "removed permission name"));
const expectedGrantedPermissions = [
  ...app.android.permissions,
  "android.permission.CAMERA",
  "android.permission.INTERNET",
  "android.permission.VIBRATE"
];
assert.deepEqual(sorted(grantedPermissions), sorted(expectedGrantedPermissions), "Android granted permissions diverged from evaluated Expo prebuild output");
assert.deepEqual(sorted(removedPermissions), sorted(app.android.blockedPermissions), "Android blocked permissions diverged from app.json");

const runtimeVersion = app.runtimeVersion?.policy === "appVersion" ? app.version : app.runtimeVersion;
assert.equal(metadataValue(manifest, "expo.modules.updates.ENABLED"), String(app.updates.enabled));
assert.equal(metadataValue(manifest, "expo.modules.updates.EXPO_UPDATE_URL"), app.updates.url);
assert.equal(metadataValue(manifest, "expo.modules.updates.EXPO_RUNTIME_VERSION"), runtimeVersion);
assert.equal(metadataValue(manifest, "expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS"), String(app.updates.fallbackToCacheTimeout ?? 0));
assert.equal(metadataValue(manifest, "expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH"), "ALWAYS");
assert.equal(app.updates.url, `https://u.expo.dev/${app.extra.eas.projectId}`);
assert.equal(eas.cli.appVersionSource, "remote");
const productionChannel = eas.build.production.channel;
assert.equal(
  metadataValue(manifest, "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"),
  `{&quot;expo-channel-name&quot;:&quot;${productionChannel}&quot;}`
);

assert.match(properties, /^newArchEnabled=true$/m);
assert.equal(app.newArchEnabled, true);
assert.match(properties, /^android\.enableMinifyInReleaseBuilds=true$/m);
assert.match(properties, /^android\.enableShrinkResourcesInReleaseBuilds=true$/m);
assert.match(properties, /^EX_DEV_CLIENT_NETWORK_INSPECTOR=false$/m);
assert.doesNotMatch(gradle, /release\s*\{[^}]{0,500}signingConfig\s+signingConfigs\.debug/s);

const pushSetup = read("src/core/push-notifications.ts");
assert.match(pushSetup, /setNotificationChannelAsync\("orders"/);
assert.match(pushSetup, /importance:\s*Notifications\.AndroidImportance\.HIGH/);

// The driver delivery alert: a dedicated channel whose custom sound must exist as a native resource.
// A channel created against a missing sound stays silent forever (Android channels are immutable
// once created), so the sound file, the plugin entry that bundles it for iOS, and the channel
// definition are all pinned together here.
const channelSetup = read("src/core/push-channels.ts");
const soundFile = capture(channelSetup, /deliveryAlertSound\s*=\s*"([^"]+)"/, "delivery alert sound file name");
assert.match(soundFile, /^[a-z0-9_]+\.wav$/, "Android raw resource names allow only lowercase letters, digits and underscores");
const notificationsPlugin = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications");
assert.ok(notificationsPlugin, "The expo-notifications config plugin is required to bundle the alert sound and the iOS push entitlement");
assert.ok(
  (notificationsPlugin[1].sounds ?? []).some((sound) => path.basename(sound) === soundFile),
  "The expo-notifications plugin must list the delivery alert sound so iOS bundles it"
);
const bundledSound = fs.readFileSync(path.join(mobileRoot, "assets", "sounds", soundFile));
const rawSound = path.join(androidRoot, "app", "src", "main", "res", "raw", soundFile);
assert.ok(fs.existsSync(rawSound), "Missing Android raw resource for the delivery alert sound: " + soundFile);
assert.ok(bundledSound.equals(fs.readFileSync(rawSound)), "Android res/raw sound differs from assets/sounds; copy it again");

for (const requiredAsset of [
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp",
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp",
  "android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png"
]) {
  assert.ok(fs.existsSync(path.join(mobileRoot, requiredAsset)), `Missing native asset ${requiredAsset}`);
}

console.log(
  `Native config is consistent: ${app.android.package}, version ${app.version} (${app.android.versionCode}), ` +
    `${grantedPermissions.length} granted and ${removedPermissions.length} blocked Android permissions.`
);
