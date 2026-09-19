import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ApiException } from "../common/api.exception";
import { ManagedImageUrlService } from "./managed-image-url.service";

const restaurantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const service = new ManagedImageUrlService(new ConfigService({
  AZURE_STORAGE_ACCOUNT_NAME: "jovoimages",
  AZURE_STORAGE_PUBLIC_CONTAINER_NAME: "product-images"
}));

describe("ManagedImageUrlService", () => {
  it("accepts a newly uploaded URL only inside the expected store and purpose namespace", () => {
    const url = `https://jovoimages.blob.core.windows.net/product-images/restaurants/${restaurantId}/products/file.webp`;
    assert.doesNotThrow(() => service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, nextUrl: url }));
    assert.throws(
      () => service.assertAllowedChange({ purpose: "LOGO", restaurantId, nextUrl: url }),
      (error: unknown) => error instanceof ApiException && (error.getResponse() as { code: string }).code === "UNTRUSTED_IMAGE_URL"
    );
  });

  it("keeps an unchanged legacy external URL but rejects a new external URL", () => {
    const legacy = "https://legacy.example/product.jpg";
    assert.doesNotThrow(() => service.assertAllowedChange({
      purpose: "PRODUCT", restaurantId, previousUrl: legacy, nextUrl: legacy
    }));
    assert.throws(() => service.assertAllowedChange({
      purpose: "PRODUCT", restaurantId, previousUrl: legacy, nextUrl: "https://other.example/product.jpg"
    }));
  });

  it("rejects query strings so a SAS URL can never be persisted", () => {
    const sas = `https://jovoimages.blob.core.windows.net/product-images/restaurants/${restaurantId}/products/file.webp?sig=secret`;
    assert.throws(() => service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, nextUrl: sas }));
  });
});
