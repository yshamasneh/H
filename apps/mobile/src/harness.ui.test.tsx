import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

test("the RNTL harness renders a component", () => {
  render(<Text>jovo-harness-ok</Text>);
  expect(screen.getByText("jovo-harness-ok")).toBeTruthy();
});
