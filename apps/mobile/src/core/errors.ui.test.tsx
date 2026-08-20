// errors.ts → api.ts → session.ts → kv-storage.ts pulls in AsyncStorage's native module,
// which has no implementation under jest; use the library's bundled jest mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import { readError } from "./errors";
import { ApiError } from "./api-error";
import i18n from "../i18n";

// TC-173 — error codes map to localized copy, then fall back gracefully.
beforeAll(async () => {
  await i18n.changeLanguage("en");
});

test("a known ApiError code resolves to its localized message, not the raw server string (TC-173)", () => {
  const message = readError(new ApiError(401, "INVALID_CREDENTIALS", "raw server text"));
  expect(message).toBe(i18n.t("errors:INVALID_CREDENTIALS"));
  expect(message).not.toBe("raw server text");
});

test("an uncatalogued code falls back to the server-provided message (TC-173)", () => {
  const message = readError(new ApiError(400, "TOTALLY_UNKNOWN_CODE_XYZ", "the server said so"));
  expect(message).toBe("the server said so");
});

test("a plain Error returns its message; a non-error returns a localized generic (TC-173)", () => {
  expect(readError(new Error("boom"))).toBe("boom");
  const generic = readError({ not: "an error" });
  expect(typeof generic).toBe("string");
  expect(generic.length).toBeGreaterThan(0);
});
