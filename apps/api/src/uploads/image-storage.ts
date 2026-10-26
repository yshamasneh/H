/**
 * Where uploaded images live. Two drivers implement it, chosen by IMAGE_STORAGE_DRIVER:
 *  - `azure` (default): Azure Blob Storage, a private staging container plus a public container
 *    (blob-image-storage.service.ts);
 *  - `s3`: any S3-compatible store — Cloudflare R2, a Railway Bucket, AWS S3 — with a private
 *    staging bucket plus a public bucket served from S3_PUBLIC_BASE_URL (s3-image-storage.service.ts).
 *
 * Both keep the same flow: the client PUTs to a short-lived, write-only URL for one generated
 * staging object; `complete` checks it and copies it to its permanent public name.
 *
 * An abstract class rather than an interface so Nest can use it as the injection token.
 */
export abstract class ImageStorage {
  abstract createUploadUrl(objectName: string, expiresAt: Date, contentType: string): Promise<string>;
  /** Headers the client must send with its PUT to the upload URL. */
  abstract uploadHeaders(contentType: string): Record<string, string>;
  abstract properties(objectName: string): Promise<{ exists: boolean; contentLength: number; contentType: string | null }>;
  abstract firstBytes(objectName: string, byteCount?: number): Promise<Buffer>;
  abstract publish(stagingObjectName: string, finalObjectName: string, contentType: string): Promise<void>;
  abstract deleteStaging(objectName: string): Promise<void>;
  abstract deletePublic(objectName: string): Promise<boolean>;
}

export const imageStorageDrivers = ["azure", "s3"] as const;
export type ImageStorageDriver = (typeof imageStorageDrivers)[number];

/** Cached for a year: a published object's name is a fresh UUID, so its bytes never change. */
export const publishedImageCacheControl = "public, max-age=31536000, immutable";
