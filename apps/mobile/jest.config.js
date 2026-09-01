// React Native Testing Library suite, kept separate from the fast pure-logic
// `node:test` suite (see the "test:unit" script). Only files named `*.ui.test.tsx`
// run here, so the two runners never try to execute each other's files.
module.exports = {
  preset: "jest-expo",
  // AsyncStorage (used by the theme context) has no native module under jest;
  // this swaps in its in-memory mock before the test modules load.
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["**/*.ui.test.tsx"],
  // The node:test files (`*.test.ts`) are not Jest tests — keep them out of this runner.
  testPathIgnorePatterns: ["/node_modules/", "\\.test\\.ts$"]
};
