// AsyncStorage has no native module under jest-expo, so the theme context (which
// persists the light/dark choice) would throw on import. Swap in the library's
// own in-memory mock for the UI-test suite.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
