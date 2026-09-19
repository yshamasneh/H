import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  completeImageUpload,
  createImageUploadUrl,
  deleteUploadedImage,
  type ImagePurpose
} from "./api";

export const maxSourceImageBytes = 5 * 1024 * 1024;
export const maxImageDimension = 1200;

export type PreparedImage = {
  uri: string;
  contentType: "image/jpeg";
  size: number;
  width: number;
  height: number;
};

export type ImageSelectionResult =
  | { status: "selected"; image: PreparedImage }
  | { status: "cancelled" }
  | { status: "permission-denied" }
  | { status: "too-large" };

export function constrainedDimensions(width: number, height: number, maximum = maxImageDimension) {
  const longest = Math.max(width, height);
  if (longest <= maximum) return { width, height };
  const scale = maximum / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
export async function chooseAndPrepareImage(source: "library" | "camera"): Promise<ImageSelectionResult> {
  const permission = source === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { status: "permission-denied" };

  const result = source === "camera"
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (result.canceled || !result.assets[0]) return { status: "cancelled" };
  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > maxSourceImageBytes) return { status: "too-large" };

  const dimensions = constrainedDimensions(asset.width, asset.height);
  const actions: ImageManipulator.Action[] = dimensions.width === asset.width && dimensions.height === asset.height
    ? []
    : [{ resize: dimensions }];
  const prepared = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG
  });
  const blob = await (await fetch(prepared.uri)).blob();
  return {
    status: "selected",
    image: {
      uri: prepared.uri,
      contentType: "image/jpeg",
      size: blob.size,
      width: prepared.width,
      height: prepared.height
    }
  };
}

export async function uploadPreparedImage(input: {
  accessToken: string;
  purpose: ImagePurpose;
  restaurantId?: string;
  image: PreparedImage;
  onProgress?: (percent: number) => void;
}): Promise<string> {
  const ticket = await createImageUploadUrl(input.accessToken, {
    purpose: input.purpose,
    restaurantId: input.restaurantId,
    contentType: input.image.contentType,
    size: input.image.size
  });
  const blob = await (await fetch(input.image.uri)).blob();
  await putBlob(ticket.uploadUrl, ticket.headers, blob, input.onProgress);
  const completed = await completeImageUpload(input.accessToken, {
    uploadId: ticket.uploadId,
    purpose: input.purpose,
    restaurantId: input.restaurantId,
    contentType: input.image.contentType
  });
  return completed.imageUrl;
}

export async function removeUploadedImage(
  accessToken: string,
  input: { purpose: ImagePurpose; restaurantId?: string; imageUrl: string }
): Promise<void> {
  try {
    await deleteUploadedImage(accessToken, input);
  } catch {
    // Legacy/external URLs are intentionally retained, and a missing managed blob is harmless.
  }
}

export function putBlob(
  uploadUrl: string,
  headers: Readonly<Record<string, string>>,
  blob: Blob,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Blob upload failed with status ${xhr.status}.`));
      }
    };
    xhr.onerror = () => reject(new Error("Blob upload failed because of a network error."));
    xhr.onabort = () => reject(new Error("Blob upload was cancelled."));
    xhr.send(blob);
  });
}
