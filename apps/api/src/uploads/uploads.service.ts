import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthorizationService } from "../common/authorization/authorization.service";
import { ApiException } from "../common/api.exception";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth.types";
import { BlobImageStorageService } from "./blob-image-storage.service";
import { imagePrefix, ManagedImageUrlService } from "./managed-image-url.service";
import { allowedImageContentTypes, type AllowedImageContentType, type ImagePurpose, type ImageUploadTicket, type UploadAuthorization } from "./uploads.types";

const extensionByType: Record<AllowedImageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly storage: BlobImageStorageService,
    private readonly managedUrls: ManagedImageUrlService,
    private readonly config: ConfigService
  ) {}

  async createUploadUrl(
    user: AuthenticatedUser,
    input: { purpose: ImagePurpose; restaurantId?: string; contentType: AllowedImageContentType; size: number }
  ): Promise<ImageUploadTicket> {
    const target = await this.authorize(user, input.purpose, input.restaurantId ?? null);
    if (!(allowedImageContentTypes as readonly string[]).includes(input.contentType)) {
      throw new ApiException(400, "IMAGE_TYPE_NOT_ALLOWED", "Only JPEG, PNG, and WebP images are allowed.");
    }
    if (!Number.isInteger(input.size) || input.size < 1 || input.size > this.maxBytes) {
      throw new ApiException(400, "IMAGE_TOO_LARGE", `Images may not exceed ${this.maxBytes} bytes.`);
    }
    const extension = extensionByType[input.contentType];
    const scope = target.restaurantId ?? "platform";
    const folder = purposeFolder(target.purpose);
    const uploadId = `pending/${user.id}/${scope}/${folder}/${randomUUID()}.${extension}`;
    const expiresAt = new Date(Date.now() + this.sasTtlSeconds * 1000);
    const uploadUrl = await this.storage.createUploadUrl(uploadId, expiresAt);
    return {
      ...target,
      uploadId,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": input.contentType }
    };
  }

  async complete(
    user: AuthenticatedUser,
    input: { uploadId: string; purpose: ImagePurpose; restaurantId?: string; contentType: AllowedImageContentType }
  ): Promise<{ imageUrl: string; blobName: string }> {
    const target = await this.authorize(user, input.purpose, input.restaurantId ?? null);
    this.assertOwnedStagingPath(input.uploadId, user.id, target, input.contentType);
    const properties = await this.storage.properties(input.uploadId);
    if (!properties.exists) throw new ApiException(404, "IMAGE_UPLOAD_NOT_FOUND", "The uploaded image was not found.");
    if (
      properties.contentLength < 1 ||
      properties.contentLength > this.maxBytes ||
      properties.contentType?.toLowerCase() !== input.contentType
    ) {
      await this.storage.deleteStaging(input.uploadId);
      throw new ApiException(400, "IMAGE_UPLOAD_INVALID", "The uploaded image type or size is invalid.");
    }
    const header = await this.storage.firstBytes(input.uploadId);
    if (!matchesSignature(header, input.contentType)) {
      await this.storage.deleteStaging(input.uploadId);
      throw new ApiException(400, "IMAGE_CONTENT_INVALID", "The uploaded file is not a valid image of the declared type.");
    }

    const filename = input.uploadId.slice(input.uploadId.lastIndexOf("/") + 1);
    const blobName = `${imagePrefix(target.purpose, target.restaurantId)}${filename}`;
    await this.storage.publish(input.uploadId, blobName, input.contentType);
    return { imageUrl: this.managedUrls.publicUrl(blobName), blobName };
  }

  async deleteImage(
    user: AuthenticatedUser,
    input: { purpose: ImagePurpose; restaurantId?: string; imageUrl: string }
  ): Promise<{ deleted: boolean }> {
    const target = await this.authorize(user, input.purpose, input.restaurantId ?? null);
    const blobName = this.managedUrls.assertOwnedUrl(input.imageUrl, target.purpose, target.restaurantId);
    return { deleted: await this.storage.deletePublic(blobName) };
  }

  private async authorize(
    user: AuthenticatedUser,
    purpose: ImagePurpose,
    restaurantId: string | null
  ): Promise<UploadAuthorization> {
    if ((purpose === "PRODUCT" || purpose === "LOGO") && !restaurantId) {
      throw new ApiException(400, "RESTAURANT_REQUIRED", "A restaurant is required for this image type.");
    }
    if (restaurantId && !(await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } }))) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "The selected restaurant does not exist.");
    }
    const context = await this.authorization.resolve(user.id, user.role);
    const permission = purpose === "OFFER"
      ? "MANAGE_OFFERS"
      : purpose === "LOGO"
        ? "MANAGE_BUSINESS_SETTINGS"
        : "MANAGE_PRODUCTS";
    const permitted = user.role === UserRole.ADMIN
      ? AuthorizationService.hasPermission(context, purpose === "OFFER" ? "MANAGE_OFFERS" : "MANAGE_BUSINESSES")
      : restaurantId !== null && AuthorizationService.hasPermission(context, permission, restaurantId);
    if (!permitted) {
      throw new ApiException(403, "FORBIDDEN_IMAGE_UPLOAD", "You cannot manage images for this target.");
    }
    return { purpose, restaurantId };
  }

  private assertOwnedStagingPath(
    uploadId: string,
    userId: string,
    target: UploadAuthorization,
    contentType: AllowedImageContentType
  ): void {
    const expectedPrefix = `pending/${userId}/${target.restaurantId ?? "platform"}/${purposeFolder(target.purpose)}/`;
    const expectedExtension = `.${extensionByType[contentType]}`;
    const filename = uploadId.slice(expectedPrefix.length);
    if (
      !uploadId.startsWith(expectedPrefix) ||
      !filename.endsWith(expectedExtension) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(filename)
    ) {
      throw new ApiException(403, "IMAGE_UPLOAD_NOT_OWNED", "This upload does not belong to the current user and target.");
    }
  }

  private get maxBytes(): number {
    return this.config.get<number>("UPLOAD_MAX_IMAGE_BYTES", 5 * 1024 * 1024);
  }

  private get sasTtlSeconds(): number {
    return this.config.get<number>("UPLOAD_SAS_TTL_SECONDS", 300);
  }
}

function purposeFolder(purpose: ImagePurpose): string {
  return purpose === "PRODUCT" ? "products" : purpose === "OFFER" ? "offers" : "logos";
}

export function matchesSignature(bytes: Buffer, contentType: AllowedImageContentType): boolean {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}
