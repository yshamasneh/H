import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiException } from "../common/api.exception";
import { assertAllowedImageUrl } from "../common/image-url.util";
import type { ImagePurpose } from "./uploads.types";

@Injectable()
export class ManagedImageUrlService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.accountName && this.publicContainerName);
  }

  publicUrl(blobName: string): string {
    this.requireConfigured();
    return `https://${this.accountName}.blob.core.windows.net/${this.publicContainerName}/${encodeBlobName(blobName)}`;
  }

  blobNameFromUrl(imageUrl: string): string | null {
    if (!this.isConfigured()) return null;
    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return null;
    }
    const containerPrefix = `/${this.publicContainerName}/`;
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== `${this.accountName}.blob.core.windows.net` ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.startsWith(containerPrefix)
    ) {
      return null;
    }
    try {
      return parsed.pathname
        .slice(containerPrefix.length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
    } catch {
      return null;
    }
  }

  /** Kept for callers that still hold the service; the rule itself lives in `assertAllowedImageUrl`. */
  assertAllowedChange(input: Parameters<typeof assertAllowedImageUrl>[0]): void {
    assertAllowedImageUrl(input);
  }

  assertOwnedUrl(imageUrl: string, purpose: ImagePurpose, restaurantId: string | null): string {
    const blobName = this.blobNameFromUrl(imageUrl);
    if (!blobName || !blobName.startsWith(imagePrefix(purpose, restaurantId))) {
      throw new ApiException(403, "IMAGE_NOT_OWNED", "This image does not belong to the selected business.");
    }
    return blobName;
  }

  private requireConfigured(): void {
    if (!this.isConfigured()) {
      throw new ApiException(503, "IMAGE_STORAGE_UNAVAILABLE", "Image storage is not configured.");
    }
  }

  private get accountName(): string {
    return this.config.get<string>("AZURE_STORAGE_ACCOUNT_NAME", "");
  }

  private get publicContainerName(): string {
    return this.config.get<string>("AZURE_STORAGE_PUBLIC_CONTAINER_NAME", "");
  }
}
export function imagePrefix(purpose: ImagePurpose, restaurantId: string | null): string {
  if (purpose === "OFFER" && !restaurantId) return "platform/offers/";
  if (!restaurantId) {
    throw new ApiException(400, "RESTAURANT_REQUIRED", "A restaurant is required for this image type.");
  }
  const folder = purpose === "PRODUCT" ? "products" : purpose === "OFFER" ? "offers" : "logos";
  return `restaurants/${restaurantId}/${folder}/`;
}

function encodeBlobName(blobName: string): string {
  return blobName.split("/").map(encodeURIComponent).join("/");
}
