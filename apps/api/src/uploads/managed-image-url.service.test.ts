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

describe("ManagedImageUrlService with the S3 driver", () => {
  const s3 = (publicBase: string) => new ManagedImageUrlService(new ConfigService({
    IMAGE_STORAGE_DRIVER: "s3",
    S3_PUBLIC_BASE_URL: publicBase,
    // Present but ignored: the selected driver decides where published images live.
    AZURE_STORAGE_ACCOUNT_NAME: "jovoimages",
    AZURE_STORAGE_PUBLIC_CONTAINER_NAME: "product-images"
  }));
  const blobName = `restaurants/${restaurantId}/products/file name.webp`;

  it("builds permanent URLs under S3_PUBLIC_BASE_URL and reads them back", () => {
    for (const base of ["https://images.jovops.com", "https://images.jovops.com/", "https://cdn.example.com/jovo/"]) {
      const service = s3(base);
      const url = service.publicUrl(blobName);
      assert.ok(url.startsWith(base.replace(/\/?$/, "/")));
      assert.ok(url.endsWith("/file%20name.webp"));
      assert.equal(service.blobNameFromUrl(url), blobName);
      assert.equal(service.assertOwnedUrl(url, "PRODUCT", restaurantId), blobName);
    }
  });

  it("does not claim Azure URLs, other hosts, other prefixes or signed links", () => {
    const service = s3("https://cdn.example.com/jovo/");
    for (const url of [
      `https://jovoimages.blob.core.windows.net/product-images/${blobName}`,
      `https://other.example.com/jovo/${blobName}`,
      `https://cdn.example.com/other/${blobName}`,
      `http://cdn.example.com/jovo/${blobName}`,
      `https://cdn.example.com/jovo/${blobName}?X-Amz-Signature=abc`
    ]) {
      assert.equal(service.blobNameFromUrl(url), null, url);
    }
  });

  it("reports unconfigured storage instead of inventing a URL", () => {
    const service = new ManagedImageUrlService(new ConfigService({ IMAGE_STORAGE_DRIVER: "s3" }));
    assert.equal(service.isConfigured(), false);
    assert.throws(() => service.publicUrl(blobName), (error: unknown) => error instanceof ApiException && error.getStatus() === 503);
  });
});
