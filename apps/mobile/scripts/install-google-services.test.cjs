const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const script = require("./install-google-services.cjs");

function withEnv(value, run) {
  const previous = process.env.GOOGLE_SERVICES_JSON;
  if (value === undefined) delete process.env.GOOGLE_SERVICES_JSON;
  else process.env.GOOGLE_SERVICES_JSON = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = previous;
  }
}

function tempFile(content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gs-")), "google-services.json");
  fs.writeFileSync(file, content);
  return file;
}

test("without GOOGLE_SERVICES_JSON the build continues and nothing is written", () => {
  const existed = fs.existsSync(script.target);
  assert.equal(withEnv(undefined, script.main), 0);
  assert.equal(fs.existsSync(script.target), existed);
});

test("a file for another package or invalid JSON stops the build", () => {
  assert.equal(withEnv(tempFile("not json"), script.main), 1);
  const other = JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: "com.example.other" } } }] });
  assert.equal(withEnv(tempFile(other), script.main), 1);
  assert.equal(withEnv("/nonexistent/google-services.json", script.main), 1);
});

test("a file for com.jovo.app is installed where Gradle looks for it", () => {
  const existed = fs.existsSync(script.target);
  if (existed) return; // never overwrite a developer's real file
  const valid = JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: "com.jovo.app" } } }] });
  try {
    assert.equal(withEnv(tempFile(valid), script.main), 0);
    assert.ok(fs.existsSync(script.target));
  } finally {
    fs.rmSync(script.target, { force: true });
  }
});
