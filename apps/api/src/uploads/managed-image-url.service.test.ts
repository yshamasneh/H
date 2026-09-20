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
  it("accepts an uploaded blob URL and a plain external URL alike, for any purpose", () => {
    const uploaded = `https://jovoimages.blob.core.windows.net/product-images/restaurants/${restaurantId}/products/file.webp`;
    for (const purpose of ["PRODUCT", "LOGO", "OFFER"] as const) {
      assert.doesNotThrow(() => service.assertAllowedChange({ purpose, restaurantId, nextUrl: uploaded }));
      assert.doesNotThrow(() =>
        service.assertAllowedChange({ purpose, restaurantId, nextUrl: "https://images.example.com/catalogue/milk.jpg" })
      );
    }
  });

  it("no longer rejects a URL just because it did not come from the uploader", () => {
    const legacy = "https://legacy.example/product.jpg";
    assert.doesNotThrow(() =>
      service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, previousUrl: legacy, nextUrl: "https://other.example/product.jpg" })
    );
    assert.doesNotThrow(() =>
      service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, previousUrl: legacy, nextUrl: legacy })
    );
  });

  it("still refuses unsafe URLs, with a specific reason", () => {
    const code = (error: unknown) => error instanceof ApiException && (error.getResponse() as { code: string }).code === "INVALID_IMAGE_URL";
    for (const bad of ["http://cdn.example.com/a.jpg", "javascript:alert(1)", "not a url", "https://u:p@cdn.example.com/a.jpg"]) {
      assert.throws(() => service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, nextUrl: bad }), code, bad);
    }
  });

  it("rejects a SAS URL so a signed link can never be persisted", () => {
    const sas = `https://jovoimages.blob.core.windows.net/product-images/restaurants/${restaurantId}/products/file.webp?sv=2023-01-01&se=2030-01-01&sp=r&sig=secret`;
    assert.throws(() => service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, nextUrl: sas }));
  });

  it("clearing the picture is always allowed", () => {
    assert.doesNotThrow(() => service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, previousUrl: "https://a.example.com/x.jpg", nextUrl: "" }));
    assert.doesNotThrow(() => service.assertAllowedChange({ purpose: "PRODUCT", restaurantId, nextUrl: null }));
  });
});
