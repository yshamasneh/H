import { fireEvent, render } from "@testing-library/react-native";
import { Image } from "react-native";
import { RemoteImage, displayableImageUri, missingProductImage } from "./remote-image";

test("a working URL renders the remote picture", () => {
  const view = render(<RemoteImage uri="https://cdn.example/milk.jpg" />);
  expect(view.UNSAFE_getByType(Image).props.source).toEqual({ uri: "https://cdn.example/milk.jpg" });
});

test("missing, blank, and invalid URLs use the exact bundled image", () => {
  for (const uri of [undefined, null, "", "   ", "not a URL", "javascript:alert(1)"]) {
    const view = render(<RemoteImage uri={uri} />);
    expect(view.UNSAFE_getByType(Image).props.source).toEqual(missingProductImage);
  }
  expect(displayableImageUri("https://cdn.example/image.jpg")).toBe("https://cdn.example/image.jpg");
});

test("a failed URL falls back once without retrying the fallback, and a new URL gets a fresh attempt", () => {
  const view = render(<RemoteImage uri="https://cdn.example/broken.jpg" />);
  fireEvent(view.UNSAFE_getByType(Image), "error");
  expect(view.UNSAFE_getByType(Image).props.source).toEqual(missingProductImage);
  expect(view.UNSAFE_getByType(Image).props.onError).toBeUndefined();

  view.rerender(<RemoteImage uri="https://cdn.example/fixed.jpg" />);
  expect(view.UNSAFE_getByType(Image).props.source).toEqual({ uri: "https://cdn.example/fixed.jpg" });
});

test("the bundled placeholder image is used by default", () => {
  const view = render(<RemoteImage uri={null} />);
  expect(view.UNSAFE_getByType(Image).props.source).toEqual(missingProductImage);
});

test.each([[1024, 1024], [1600, 900], [900, 1600]])("square, wide, and tall images keep their chosen crop mode (%i×%i)", (width, height) => {
  const view = render(<RemoteImage resizeMode="cover" uri="https://cdn.example/product.jpg" />);
  fireEvent(view.UNSAFE_getByType(Image), "load", { nativeEvent: { source: { width, height } } });
  expect(view.UNSAFE_getByType(Image).props.resizeMode).toBe("cover");
  expect(view.UNSAFE_getByType(Image).props.source).toEqual({ uri: "https://cdn.example/product.jpg" });
  view.rerender(<RemoteImage resizeMode="contain" uri="https://cdn.example/product.jpg" />);
  expect(view.UNSAFE_getByType(Image).props.resizeMode).toBe("contain");
});
