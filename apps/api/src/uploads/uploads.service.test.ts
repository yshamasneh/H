import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ConfigService } from "@nestjs/config";
import type { AuthorizationContext } from "../common/authorization/authorization.service";
import { ApiException } from "../common/api.exception";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthenticatedUser } from "../auth/auth.types";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

const userId = "11111111-1111-4111-8111-111111111111";
const restaurantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const restaurantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const user = (role: UserRole): AuthenticatedUser => ({
  id: userId,
  fullName: "Test User",
  phone: "+970590000000",
  role,
  sessionId: "session",
  tokenVersion: 0
});

class FakeStorage {
  created: string[] = [];
  deletedStaging: string[] = [];
  deletedPublic: string[] = [];
  published: { staging: string; final: string; type: string }[] = [];
  props = { exists: true, contentLength: 128, contentType: "image/jpeg" as string | null };
  bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

  async createUploadUrl(blobName: string) {
    this.created.push(blobName);
    return `https://upload.invalid/${blobName}?sig=SECRET_SAS`;
  }
  async properties() { return this.props; }
  async firstBytes() { return this.bytes; }
  async publish(staging: string, final: string, type: string) { this.published.push({ staging, final, type }); }
  async deleteStaging(blobName: string) { this.deletedStaging.push(blobName); }
  async deletePublic(blobName: string) { this.deletedPublic.push(blobName); return true; }
}

class FakeManagedUrls {
  publicUrl(blobName: string) { return `https://images.invalid/public/${blobName}`; }
  assertOwnedUrl(url: string, purpose: string, restaurantId: string | null) {
    const prefix = purpose === "OFFER" && !restaurantId
      ? "platform/offers/"
      : `restaurants/${restaurantId}/${purpose === "PRODUCT" ? "products" : purpose === "OFFER" ? "offers" : "logos"}/`;
    const blobName = url.replace("https://images.invalid/public/", "");
    if (!blobName.startsWith(prefix)) throw new ApiException(403, "IMAGE_NOT_OWNED", "not owned");
    return blobName;
  }
}

function context(input: { superAdmin?: boolean; businessId?: string } = {}): AuthorizationContext {
  return {
    userId,
    isSuperAdmin: input.superAdmin ?? false,
    platformPermissions: new Set(),
    businessGrants: input.businessId
      ? [{ businessId: input.businessId, roleKey: "BUSINESS_ADMIN", permissions: new Set(["MANAGE_PRODUCTS", "MANAGE_BUSINESS_SETTINGS"] as const) }]
      : []
  };
}

function fixture(authContext = context({ businessId: restaurantA })) {
  const storage = new FakeStorage();
  const prisma = { restaurant: { findUnique: async ({ where }: { where: { id: string } }) => where.id === restaurantA || where.id === restaurantB ? { id: where.id } : null } };
  const authorization = { resolve: async () => authContext };
  const config = new ConfigService({ UPLOAD_MAX_IMAGE_BYTES: 5 * 1024 * 1024, UPLOAD_SAS_TTL_SECONDS: 300 });
  const service = new UploadsService(
    prisma as never,
    authorization as never,
    storage as never,
    new FakeManagedUrls() as never,
    config
  );
  return { service, storage };
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(error instanceof ApiException, true);
    assert.equal((error as ApiException).getResponse().toString().includes(code), false);
    assert.equal(((error as ApiException).getResponse() as { code: string }).code, code);
    return true;
  });
}

describe("UploadsService", () => {
  it("keeps JwtAuthGuard and role enforcement on every upload endpoint", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, UploadsController) as unknown[];
    assert.deepEqual(guards, [JwtAuthGuard, RolesGuard]);
  });

  it("rejects a request without an authenticated session", async () => {
    const guard = new JwtAuthGuard({} as never, {} as never, {} as never);
    const request = { header: () => undefined };
    const executionContext = {
      switchToHttp: () => ({ getRequest: () => request })
    };
    await expectCode(() => guard.canActivate(executionContext as never), "UNAUTHORIZED");
  });

  it("rejects an unprivileged role", async () => {
    const { service } = fixture(context());
    await expectCode(() => service.createUploadUrl(user(UserRole.CUSTOMER), {
      purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg", size: 100
    }), "FORBIDDEN_IMAGE_UPLOAD");
  });

  it("rejects a restaurant account targeting another store", async () => {
    const { service } = fixture(context({ businessId: restaurantA }));
    await expectCode(() => service.createUploadUrl(user(UserRole.RESTAURANT), {
      purpose: "PRODUCT", restaurantId: restaurantB, contentType: "image/jpeg", size: 100
    }), "FORBIDDEN_IMAGE_UPLOAD");
  });

  it("rejects unsupported file types and an excessive declared size", async () => {
    const { service } = fixture();
    await expectCode(() => service.createUploadUrl(user(UserRole.RESTAURANT), {
      purpose: "PRODUCT", restaurantId: restaurantA, contentType: "application/pdf" as never, size: 100
    }), "IMAGE_TYPE_NOT_ALLOWED");
    await expectCode(() => service.createUploadUrl(user(UserRole.RESTAURANT), {
      purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg", size: 5 * 1024 * 1024 + 1
    }), "IMAGE_TOO_LARGE");
  });

  it("issues a ticket for one generated blob inside the actor and store namespace", async () => {
    const { service, storage } = fixture();
    const ticket = await service.createUploadUrl(user(UserRole.RESTAURANT), {
      purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg", size: 100
    });
    assert.match(ticket.uploadId, new RegExp(`^pending/${userId}/${restaurantA}/products/[0-9a-f-]+\\.jpg$`));
    assert.deepEqual(storage.created, [ticket.uploadId]);
    assert.deepEqual(ticket.headers, { "x-ms-blob-type": "BlockBlob", "Content-Type": "image/jpeg" });
  });

  it("rejects completion when the blob does not exist", async () => {
    const { service, storage } = fixture();
    const ticket = await service.createUploadUrl(user(UserRole.RESTAURANT), {
      purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg", size: 100
    });
    storage.props.exists = false;
    await expectCode(() => service.complete(user(UserRole.RESTAURANT), {
      uploadId: ticket.uploadId, purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg"
    }), "IMAGE_UPLOAD_NOT_FOUND");
  });

  it("deletes a staging blob whose actual size, property type, or signature is invalid", async () => {
    for (const mutate of [
      (storage: FakeStorage) => { storage.props.contentLength = 5 * 1024 * 1024 + 1; },
      (storage: FakeStorage) => { storage.props.contentType = "image/png"; },
      (storage: FakeStorage) => { storage.bytes = Buffer.from("not-an-image"); }
    ]) {
      const { service, storage } = fixture();
      const ticket = await service.createUploadUrl(user(UserRole.RESTAURANT), {
        purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg", size: 100
      });
      mutate(storage);
      await assert.rejects(() => service.complete(user(UserRole.RESTAURANT), {
        uploadId: ticket.uploadId, purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg"
      }));
      assert.deepEqual(storage.deletedStaging, [ticket.uploadId]);
      assert.equal(storage.published.length, 0);
    }
  });

  it("publishes a valid image to the exact final store namespace", async () => {
    const { service, storage } = fixture();
    const ticket = await service.createUploadUrl(user(UserRole.RESTAURANT), {
      purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg", size: 100
    });
    const result = await service.complete(user(UserRole.RESTAURANT), {
      uploadId: ticket.uploadId, purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg"
    });
    assert.match(result.blobName, new RegExp(`^restaurants/${restaurantA}/products/[0-9a-f-]+\\.jpg$`));
    assert.equal(storage.published[0]?.final, result.blobName);
  });

  it("does not delete another store's image", async () => {
    const { service, storage } = fixture(context({ businessId: restaurantA }));
    await expectCode(() => service.deleteImage(user(UserRole.RESTAURANT), {
      purpose: "PRODUCT",
      restaurantId: restaurantB,
      imageUrl: `https://images.invalid/public/restaurants/${restaurantB}/products/file.jpg`
    }), "FORBIDDEN_IMAGE_UPLOAD");
    assert.equal(storage.deletedPublic.length, 0);
  });

  it("does not write the SAS URL to console output", async () => {
    const { service } = fixture();
    const seen: unknown[][] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => { seen.push(args); };
    console.error = (...args) => { seen.push(args); };
    try {
      await service.createUploadUrl(user(UserRole.RESTAURANT), {
        purpose: "PRODUCT", restaurantId: restaurantA, contentType: "image/jpeg", size: 100
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    assert.equal(JSON.stringify(seen).includes("SECRET_SAS"), false);
  });
});
