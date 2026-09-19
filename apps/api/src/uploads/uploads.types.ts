export const imagePurposes = ["PRODUCT", "OFFER", "LOGO"] as const;
export type ImagePurpose = (typeof imagePurposes)[number];

export const allowedImageContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageContentType = (typeof allowedImageContentTypes)[number];

export type UploadAuthorization = {
  purpose: ImagePurpose;
  restaurantId: string | null;
};
export type ImageUploadTicket = UploadAuthorization & {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
  headers: Readonly<Record<string, string>>;
};
