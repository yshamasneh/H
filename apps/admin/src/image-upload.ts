import { completeImageUpload, createImageUploadUrl, deleteUploadedImage, type ImagePurpose } from "./api";

export const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const maxImageBytes = 5 * 1024 * 1024;

export function validateImageFile(file: Pick<File, "type" | "size">): "type" | "size" | null {
  if (!(allowedImageTypes as readonly string[]).includes(file.type)) return "type";
  if (file.size < 1 || file.size > maxImageBytes) return "size";
  return null;
}
export async function uploadImage(input: {
  file: File;
  purpose: ImagePurpose;
  restaurantId?: string;
  onProgress?: (percent: number) => void;
}): Promise<string> {
  const contentType = input.file.type as (typeof allowedImageTypes)[number];
  const ticket = await createImageUploadUrl({
    purpose: input.purpose,
    restaurantId: input.restaurantId,
    contentType,
    size: input.file.size
  });
  await putBlob(ticket.uploadUrl, ticket.headers, input.file, input.onProgress);
  return (await completeImageUpload({
    uploadId: ticket.uploadId,
    purpose: input.purpose,
    restaurantId: input.restaurantId,
    contentType
  })).imageUrl;
}

export async function removeUploadedImage(input: { purpose: ImagePurpose; restaurantId?: string; imageUrl: string }) {
  try {
    await deleteUploadedImage(input);
  } catch {
    // The API deliberately refuses external legacy URLs and images outside this store.
  }
}

export function putBlob(
  uploadUrl: string,
  headers: Readonly<Record<string, string>>,
  file: Blob,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else reject(new Error(`Blob upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error("Blob upload failed because of a network error."));
    xhr.onabort = () => reject(new Error("Blob upload was cancelled."));
    xhr.send(file);
  });
}
