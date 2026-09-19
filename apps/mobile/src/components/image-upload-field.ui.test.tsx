import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Image } from "react-native";
import i18n from "../i18n";
import { chooseAndPrepareImage } from "../core/image-upload";
import { ImageUploadField } from "./image-upload-field";
import { RemoteImage } from "./remote-image";

jest.mock("../core/image-upload", () => ({
  chooseAndPrepareImage: jest.fn()
}));

const choose = chooseAndPrepareImage as jest.Mock;

beforeAll(async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
});
beforeEach(() => jest.clearAllMocks());

test("selecting an image returns its prepared local preview", async () => {
  const image = { uri: "file:///prepared.jpg", contentType: "image/jpeg", size: 120, width: 800, height: 600 };
  choose.mockResolvedValue({ status: "selected", image });
  const onChange = jest.fn();
  render(<ImageUploadField onChange={onChange} uri={null} />);
  fireEvent.press(screen.getByText("Add image"));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(image));
});

test("cancelling the picker leaves the draft untouched", async () => {
  choose.mockResolvedValue({ status: "cancelled" });
  const onChange = jest.fn();
  render(<ImageUploadField onChange={onChange} uri={null} />);
  fireEvent.press(screen.getByText("Add image"));
  await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
  expect(onChange).not.toHaveBeenCalled();
});

test("upload progress disables image changes until completion", () => {
  const onChange = jest.fn();
  render(<ImageUploadField onChange={onChange} progress={37} uri={null} />);
  expect(screen.getByText("Uploading 37%")).toBeTruthy();
  fireEvent.press(screen.getByText("Add image"));
  expect(choose).not.toHaveBeenCalled();
});

test("the reusable image swaps a broken remote URL for the bundled fallback", () => {
  const view = render(<RemoteImage accessibilityLabel="preview" uri="https://invalid.example/missing.jpg" />);
  const remote = view.UNSAFE_getByType(Image);
  expect(remote.props.source).toEqual({ uri: "https://invalid.example/missing.jpg" });
  fireEvent(remote, "error");
  expect(view.UNSAFE_getByType(Image).props.source).not.toEqual({ uri: "https://invalid.example/missing.jpg" });
  view.rerender(<RemoteImage accessibilityLabel="preview" uri={null} />);
  expect(view.UNSAFE_getByType(Image).props.source).not.toEqual({ uri: "https://invalid.example/missing.jpg" });
});
