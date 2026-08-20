import { backIconName, disclosureIconName } from "./icon";
import * as tokens from "./tokens";

// Control the direction source so both LTR and RTL are exercised (TC-176).
jest.mock("./tokens", () => ({
  ...jest.requireActual("./tokens"),
  isRTL: jest.fn()
}));

const mockedIsRTL = tokens.isRTL as jest.Mock;

test("directional icons point the LTR way when not RTL (TC-176)", () => {
  mockedIsRTL.mockReturnValue(false);
  expect(backIconName()).toBe("back");
  expect(disclosureIconName()).toBe("chevronForward");
});

test("directional icons mirror for RTL (TC-176)", () => {
  mockedIsRTL.mockReturnValue(true);
  expect(backIconName()).toBe("forward");
  expect(disclosureIconName()).toBe("chevronBack");
});
