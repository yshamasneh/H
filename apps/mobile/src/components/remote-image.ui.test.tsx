import { fireEvent, render } from "@testing-library/react-native";
import { Image, Text } from "react-native";
import { RemoteImage } from "./remote-image";

const emoji = <Text>🥫</Text>;

test("a working URL renders the picture, not the fallback node", () => {
  const view = render(<RemoteImage fallback={emoji} uri="https://cdn.example/milk.jpg" />);
  expect(view.UNSAFE_getByType(Image).props.source).toEqual({ uri: "https://cdn.example/milk.jpg" });
  expect(view.queryByText("🥫")).toBeNull();
});

test("a missing or blank URL renders the fallback node instead of blank space", () => {
  for (const uri of [undefined, null, "", "   "]) {
    const view = render(<RemoteImage fallback={emoji} uri={uri} />);
    expect(view.getByText("🥫")).toBeTruthy();
    expect(view.UNSAFE_queryByType(Image)).toBeNull();
  }
});

test("a URL that fails to load swaps to the fallback node, and a new URL gets a fresh attempt", () => {
  const view = render(<RemoteImage fallback={emoji} uri="https://cdn.example/broken.jpg" />);
  fireEvent(view.UNSAFE_getByType(Image), "error");
  expect(view.getByText("🥫")).toBeTruthy();

  view.rerender(<RemoteImage fallback={emoji} uri="https://cdn.example/fixed.jpg" />);
  expect(view.UNSAFE_getByType(Image).props.source).toEqual({ uri: "https://cdn.example/fixed.jpg" });
});

test("without a fallback node the bundled placeholder image is used, as before", () => {
  const view = render(<RemoteImage uri={null} />);
  expect(view.UNSAFE_getByType(Image).props.source).not.toEqual({ uri: null });
});
