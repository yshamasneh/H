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
}, services: {
  createTicket: typeof createImageUploadUrl;
  put: typeof putBlob;
  complete: typeof completeImageUpload;
} = { createTicket: createImageUploadUrl, put: putBlob, complete: completeImageUpload }): Promise<string> {
  if (validateImageFile(input.file)) throw new Error("Invalid image file.");
  const contentType = input.file.type as (typeof allowedImageTypes)[number];
  const ticket = await services.createTicket({
    purpose: input.purpose,
    restaurantId: input.restaurantId,
    contentType,
    size: input.file.size
  });
  await services.put(ticket.uploadUrl, ticket.headers, input.file, input.onProgress);
  return (await services.complete({
    uploadId: ticket.uploadId,
    purpose: input.purpose,
    restaurantId: input.restaurantId,
    contentType
  })).imageUrl;
}

/** Keep the old image until the product write succeeds; list refresh is deliberately separate. */
export async function saveProductWithImage<T>(input: {
  selection: File | null | undefined;
  previousUrl: string | null;
  draftUrl: string;
  restaurantId: string;
  save: (imageUrl: string | undefined) => Promise<T>;
  onProgress?: (percent: number) => void;
  upload?: typeof uploadImage;
  remove?: typeof removeUploadedImage;
}): Promise<T> {
  const upload = input.upload ?? uploadImage;
  const remove = input.remove ?? removeUploadedImage;
  let uploadedUrl: string | null = null;
  if (input.selection instanceof File) {
    uploadedUrl = await upload({ file: input.selection, purpose: "PRODUCT", restaurantId: input.restaurantId, onProgress: input.onProgress });
  }
  const nextUrl = input.selection === null ? "" : uploadedUrl ?? (input.draftUrl.trim() || undefined);
  let result: T;
  try {
    result = await input.save(nextUrl);
  } catch (error) {
    if (uploadedUrl) await remove({ purpose: "PRODUCT", restaurantId: input.restaurantId, imageUrl: uploadedUrl });
    throw error;
  }
  if (input.previousUrl && nextUrl !== undefined && input.previousUrl !== nextUrl) {
    await remove({ purpose: "PRODUCT", restaurantId: input.restaurantId, imageUrl: input.previousUrl });
  }
  return result;
}

export function isSafeExternalImageUrl(value: string): boolean {
  try {
    if (/\s/.test(value.trim())) return false;
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return false;
    const keys = new Set([...url.searchParams.keys()].map((key) => key.toLowerCase()));
    return !(keys.has("sig") || keys.has("x-amz-signature") || keys.has("x-goog-signature") || keys.has("signature"));
  } catch {
    return false;
  }
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
