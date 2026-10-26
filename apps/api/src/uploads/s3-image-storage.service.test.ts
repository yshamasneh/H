import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ConfigService } from "@nestjs/config";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
import { ApiException } from "../common/api.exception";
import { BlobImageStorageService } from "./blob-image-storage.service";
import { ImageStorage } from "./image-storage";
import { S3ImageStorageService } from "./s3-image-storage.service";
import { createImageStorage } from "./uploads.module";

const settings = {
  IMAGE_STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: false,
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key-never-in-a-url",
  S3_UPLOAD_BUCKET: "jovo-image-uploads",
  S3_PUBLIC_BUCKET: "jovo-images",
  S3_PUBLIC_BASE_URL: "https://images.example.com/"
};
const staging = "pending/user/store/products/0f8fad5b-d9cb-469f-a165-70867728950e.webp";
const published = "restaurants/store/products/0f8fad5b-d9cb-469f-a165-70867728950e.webp";

function notFound(): S3ServiceException {
  return new S3ServiceException({ name: "NotFound", $fault: "client", $metadata: { httpStatusCode: 404 } });
}

describe("S3ImageStorageService", () => {
  const originalSend = S3Client.prototype.send;
  let sent: unknown[];
  let respond: (command: unknown) => unknown;

  beforeEach(() => {
    sent = [];
    respond = () => ({});
    S3Client.prototype.send = async function (command: unknown) {
      sent.push(command);
      return respond(command);
    } as typeof S3Client.prototype.send;
  });
  afterEach(() => {
    S3Client.prototype.send = originalSend;
  });

  const storage = () => new S3ImageStorageService(new ConfigService(settings));

  it("presigns a short-lived PUT for one staging object with its content type signed", async () => {
    const url = new URL(await storage().createUploadUrl(staging, new Date(Date.now() + 300_000), "image/webp"));
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "jovo-image-uploads.account.r2.cloudflarestorage.com");
    assert.equal(url.pathname, `/${staging}`);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    assert.match(url.searchParams.get("X-Amz-SignedHeaders") ?? "", /content-type/);
    assert.ok(!url.toString().includes(settings.S3_SECRET_ACCESS_KEY));
    assert.deepEqual(storage().uploadHeaders("image/webp"), { "Content-Type": "image/webp" });
  });

  it("uses path-style URLs when S3_FORCE_PATH_STYLE is set", async () => {
    const service = new S3ImageStorageService(new ConfigService({ ...settings, S3_FORCE_PATH_STYLE: true }));
    const url = new URL(await service.createUploadUrl(staging, new Date(Date.now() + 60_000), "image/png"));
    assert.equal(url.hostname, "account.r2.cloudflarestorage.com");
    assert.equal(url.pathname, `/jovo-image-uploads/${staging}`);
  });

  it("reports a staging object's size and type, and a missing one as absent", async () => {
    respond = () => ({ ContentLength: 2048, ContentType: "image/webp" });
    assert.deepEqual(await storage().properties(staging), { exists: true, contentLength: 2048, contentType: "image/webp" });
    const head = sent[0] as HeadObjectCommand;
    assert.ok(head instanceof HeadObjectCommand);
    assert.deepEqual(head.input, { Bucket: "jovo-image-uploads", Key: staging });

    respond = () => { throw notFound(); };
    assert.deepEqual(await storage().properties(staging), { exists: false, contentLength: 0, contentType: null });
  });

  it("reads only the first bytes of a staging object", async () => {
    respond = () => ({ Body: { transformToByteArray: async () => new Uint8Array(Buffer.from("RIFF....WEBPVP8 extra")) } });
    const bytes = await storage().firstBytes(staging, 12);
    assert.equal(bytes.toString("ascii"), "RIFF....WEBP");
    const get = sent[0] as GetObjectCommand;
    assert.ok(get instanceof GetObjectCommand);
    assert.equal(get.input.Range, "bytes=0-11");
  });

  it("publishes by copying into the public bucket with immutable caching, then deletes the staging copy", async () => {
    await storage().publish(staging, published, "image/webp");
    const [copy, remove] = sent as [CopyObjectCommand, DeleteObjectCommand];
    assert.ok(copy instanceof CopyObjectCommand);
    assert.deepEqual(copy.input, {
      Bucket: "jovo-images",
      Key: published,
      CopySource: `jovo-image-uploads/${staging}`,
      MetadataDirective: "REPLACE",
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable"
    });
    assert.ok(remove instanceof DeleteObjectCommand);
    assert.deepEqual(remove.input, { Bucket: "jovo-image-uploads", Key: staging });
  });

  it("turns a failed copy into IMAGE_COPY_FAILED and keeps the staging object", async () => {
    respond = (command) => {
      if (command instanceof CopyObjectCommand) throw new Error("copy failed");
      return {};
    };
    await assert.rejects(
      storage().publish(staging, published, "image/webp"),
      (error: unknown) => error instanceof ApiException && error.getStatus() === 502
    );
    const deletes = sent.filter((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand);
    assert.deepEqual(deletes.map((command) => command.input), [{ Bucket: "jovo-images", Key: published }]);
  });

  it("deletes a public object and says whether it existed", async () => {
    assert.equal(await storage().deletePublic(published), true);
    assert.deepEqual((sent[1] as DeleteObjectCommand).input, { Bucket: "jovo-images", Key: published });

    sent = [];
    respond = () => { throw notFound(); };
    assert.equal(await storage().deletePublic(published), false);
    assert.equal(sent.length, 1);
  });

  it("answers 503 instead of calling out while unconfigured", async () => {
    const service = new S3ImageStorageService(new ConfigService({ IMAGE_STORAGE_DRIVER: "s3" }));
    await assert.rejects(
      service.properties(staging),
      (error: unknown) => error instanceof ApiException && error.getStatus() === 503
    );
    assert.equal(sent.length, 0);
  });
});

describe("createImageStorage", () => {
  it("selects the driver from IMAGE_STORAGE_DRIVER, Azure by default", () => {
    assert.ok(createImageStorage(new ConfigService({})) instanceof BlobImageStorageService);
    assert.ok(createImageStorage(new ConfigService({ IMAGE_STORAGE_DRIVER: "azure" })) instanceof BlobImageStorageService);
    const s3 = createImageStorage(new ConfigService({ IMAGE_STORAGE_DRIVER: "s3" }));
    assert.ok(s3 instanceof S3ImageStorageService);
    assert.ok(s3 instanceof ImageStorage);
  });

  it("keeps the Azure upload headers the clients already send", () => {
    assert.deepEqual(new BlobImageStorageService(new ConfigService({})).uploadHeaders("image/jpeg"), {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "image/jpeg"
    });
  });
});
