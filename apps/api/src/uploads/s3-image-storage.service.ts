import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiException } from "../common/api.exception";
import { ImageStorage, publishedImageCacheControl } from "./image-storage";

/**
 * S3-compatible image storage (IMAGE_STORAGE_DRIVER=s3): Cloudflare R2, a Railway Bucket, AWS S3,
 * or anything else that speaks the S3 API. Nothing here is provider-specific; the endpoint,
 * region, addressing style and buckets all come from S3_* settings (config/environment.ts).
 *
 * Mirrors the Azure driver: clients PUT to a presigned, write-only URL for one generated object in
 * the private upload bucket; `publish` copies it into the public bucket, whose objects are served
 * at S3_PUBLIC_BASE_URL (ManagedImageUrlService), and deletes the staging copy.
 */
@Injectable()
export class S3ImageStorageService extends ImageStorage {
  private s3Client?: S3Client;

  constructor(private readonly config: ConfigService) {
    super();
  }

  async createUploadUrl(objectName: string, expiresAt: Date, contentType: string): Promise<string> {
    const expiresIn = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 1000));
    // ContentType is signed, so the PUT must carry the declared type; `complete` still verifies
    // the stored type, size and magic bytes before anything is published.
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.uploadBucket, Key: objectName, ContentType: contentType }),
      { expiresIn, signableHeaders: new Set(["content-type"]) }
    );
  }

  uploadHeaders(contentType: string): Record<string, string> {
    return { "Content-Type": contentType };
  }

  async properties(objectName: string): Promise<{ exists: boolean; contentLength: number; contentType: string | null }> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.uploadBucket, Key: objectName }));
      return { exists: true, contentLength: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
    } catch (error) {
      if (isNotFound(error)) return { exists: false, contentLength: 0, contentType: null };
      throw error;
    }
  }

  async firstBytes(objectName: string, byteCount = 16): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.uploadBucket, Key: objectName, Range: `bytes=0-${byteCount - 1}` })
    );
    const bytes = await response.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []).subarray(0, byteCount);
  }

  async publish(stagingObjectName: string, finalObjectName: string, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.publicBucket,
          Key: finalObjectName,
          CopySource: `${this.uploadBucket}/${encodeObjectName(stagingObjectName)}`,
          MetadataDirective: "REPLACE",
          ContentType: contentType,
          CacheControl: publishedImageCacheControl
        })
      );
    } catch {
      await this.deleteQuietly(this.publicBucket, finalObjectName);
      throw new ApiException(502, "IMAGE_COPY_FAILED", "The uploaded image could not be published.");
    }
    await this.deleteStaging(stagingObjectName);
  }

  async deleteStaging(objectName: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.uploadBucket, Key: objectName }));
  }

  async deletePublic(objectName: string): Promise<boolean> {
    // S3 DELETE succeeds whether or not the object existed, so look first to report it honestly.
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.publicBucket, Key: objectName }));
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: this.publicBucket, Key: objectName }));
    return true;
  }

  private async deleteQuietly(bucket: string, objectName: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectName }));
    } catch {
      // Best effort: the copy failed, so there is usually nothing to remove.
    }
  }

  private get client(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        endpoint: this.required("S3_ENDPOINT"),
        region: this.config.get<string>("S3_REGION", "auto"),
        forcePathStyle: this.config.get<boolean>("S3_FORCE_PATH_STYLE", false),
        credentials: {
          accessKeyId: this.required("S3_ACCESS_KEY_ID"),
          secretAccessKey: this.required("S3_SECRET_ACCESS_KEY")
        }
      });
    }
    return this.s3Client;
  }

  private get uploadBucket(): string {
    return this.required("S3_UPLOAD_BUCKET");
  }

  private get publicBucket(): string {
    return this.required("S3_PUBLIC_BUCKET");
  }

  private required(key: string): string {
    const value = this.config.get<string>(key, "");
    if (!value) throw new ApiException(503, "IMAGE_STORAGE_UNAVAILABLE", "Image storage is not configured.");
    return value;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === "NotFound" || error.name === "NoSuchKey");
}

function encodeObjectName(objectName: string): string {
  return objectName.split("/").map(encodeURIComponent).join("/");
}
