import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiException } from "../common/api.exception";
import { assertAllowedImageUrl } from "../common/image-url.util";
import type { ImagePurpose } from "./uploads.types";

@Injectable()
export class ManagedImageUrlService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.publicBase !== null;
  }

  publicUrl(blobName: string): string {
    const base = this.publicBase;
    if (!base) throw new ApiException(503, "IMAGE_STORAGE_UNAVAILABLE", "Image storage is not configured.");
    return `${base.origin}${base.pathPrefix}${encodeBlobName(blobName)}`;
  }

  blobNameFromUrl(imageUrl: string): string | null {
    const base = this.publicBase;
    if (!base) return null;
    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return null;
    }
    const containerPrefix = base.pathPrefix;
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== base.origin ||
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

  /**
   * Where published images are served from, as an origin plus a path prefix ending in "/":
   * the public Azure container, or S3_PUBLIC_BASE_URL for the S3 driver (an R2 custom domain,
   * a CDN, or any permanent public front for the public bucket). Null while unconfigured.
   */
  private get publicBase(): { origin: string; pathPrefix: string } | null {
    if (this.config.get<string>("IMAGE_STORAGE_DRIVER", "azure") === "s3") {
      const configured = this.config.get<string>("S3_PUBLIC_BASE_URL", "");
      if (!configured) return null;
      const url = new URL(configured);
      return { origin: url.origin, pathPrefix: url.pathname.replace(/\/*$/, "/") };
    }
    const accountName = this.config.get<string>("AZURE_STORAGE_ACCOUNT_NAME", "");
    const containerName = this.config.get<string>("AZURE_STORAGE_PUBLIC_CONTAINER_NAME", "");
    if (!accountName || !containerName) return null;
    return { origin: `https://${accountName}.blob.core.windows.net`, pathPrefix: `/${containerName}/` };
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
