import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { chooseAndPrepareImage, constrainedDimensions, putBlob } from "./image-upload";

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn()
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" }
}));

beforeEach(() => jest.clearAllMocks());

test("resizes the long side to 1200 and encodes JPEG at 80%", async () => {
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///source.png", width: 2400, height: 1200, fileSize: 2000 }]
  });
  (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({ uri: "file:///prepared.jpg", width: 1200, height: 600 });
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ blob: async () => ({ size: 900 }) }) as never;
  try {
    const result = await chooseAndPrepareImage("library");
    expect(result).toEqual({
      status: "selected",
      image: { uri: "file:///prepared.jpg", contentType: "image/jpeg", size: 900, width: 1200, height: 600 }
    });
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file:///source.png",
      [{ resize: { width: 1200, height: 600 } }],
      { compress: 0.8, format: "jpeg" }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
test("picker cancellation and denied permissions do not produce an image", async () => {
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  await expect(chooseAndPrepareImage("library")).resolves.toEqual({ status: "permission-denied" });
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
  await expect(chooseAndPrepareImage("library")).resolves.toEqual({ status: "cancelled" });
});

test("dimension calculation never upscales a small image", () => {
  expect(constrainedDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  expect(constrainedDimensions(600, 2400)).toEqual({ width: 300, height: 1200 });
});

test("direct PUT reports progress and resolves only for a successful status", async () => {
  const original = global.XMLHttpRequest;
  class FakeXhr {
    static status = 201;
    status = FakeXhr.status;
    upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    open() {}
    setRequestHeader() {}
    send() {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
      this.onload?.();
    }
  }
  global.XMLHttpRequest = FakeXhr as never;
  try {
    const progress: number[] = [];
    await expect(putBlob("https://upload.invalid", {}, new Blob(["ok"]), (value) => progress.push(value))).resolves.toBeUndefined();
    expect(progress).toEqual([50, 100]);
    FakeXhr.status = 403;
    await expect(putBlob("https://upload.invalid", {}, new Blob(["no"]))).rejects.toThrow("status 403");
  } finally {
    global.XMLHttpRequest = original;
  }
});
