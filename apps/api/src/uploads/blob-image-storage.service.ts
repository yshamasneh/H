import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
  type BlockBlobClient
} from "@azure/storage-blob";
import { ApiException } from "../common/api.exception";

@Injectable()
export class BlobImageStorageService {
  private serviceClient?: BlobServiceClient;

  constructor(private readonly config: ConfigService) {}

  async createUploadUrl(blobName: string, expiresAt: Date): Promise<string> {
    const now = new Date();
    const startsOn = new Date(now.getTime() - 60_000);
    const delegationKey = await this.client.getUserDelegationKey(startsOn, new Date(expiresAt.getTime() + 60_000));
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.uploadContainer,
        blobName,
        permissions: BlobSASPermissions.parse("cw"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn: expiresAt
      },
      delegationKey,
      this.accountName
    ).toString();
    return `${this.uploadBlob(blobName).url}?${sas}`;
  }

  async properties(blobName: string): Promise<{ exists: boolean; contentLength: number; contentType: string | null }> {
    const blob = this.uploadBlob(blobName);
    if (!(await blob.exists())) return { exists: false, contentLength: 0, contentType: null };
    const properties = await blob.getProperties();
    return {
      exists: true,
      contentLength: properties.contentLength ?? 0,
      contentType: properties.contentType ?? null
    };
  }

  async firstBytes(blobName: string, byteCount = 16): Promise<Buffer> {
    const response = await this.uploadBlob(blobName).download(0, byteCount);
    const chunks: Buffer[] = [];
    for await (const chunk of response.readableStreamBody ?? []) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).subarray(0, byteCount);
  }

  async publish(stagingBlobName: string, finalBlobName: string, contentType: string): Promise<void> {
    const sourceUrl = await this.createReadUrl(stagingBlobName);
    const target = this.publicBlob(finalBlobName);
    const poller = await target.beginCopyFromURL(sourceUrl);
    const result = await poller.pollUntilDone();
    if (result.copyStatus !== "success") {
      await target.deleteIfExists();
      throw new ApiException(502, "IMAGE_COPY_FAILED", "The uploaded image could not be published.");
    }
    await target.setHTTPHeaders({ blobContentType: contentType, blobCacheControl: "public, max-age=31536000, immutable" });
    await this.deleteStaging(stagingBlobName);
  }

  async deleteStaging(blobName: string): Promise<void> {
    await this.uploadBlob(blobName).deleteIfExists({ deleteSnapshots: "include" });
  }

  async deletePublic(blobName: string): Promise<boolean> {
    return (await this.publicBlob(blobName).deleteIfExists({ deleteSnapshots: "include" })).succeeded;
  }

  private async createReadUrl(blobName: string): Promise<string> {
    const now = new Date();
    const startsOn = new Date(now.getTime() - 60_000);
    const expiresOn = new Date(now.getTime() + 5 * 60_000);
    const delegationKey = await this.client.getUserDelegationKey(startsOn, expiresOn);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.uploadContainer,
        blobName,
        permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn
      },
      delegationKey,
      this.accountName
    ).toString();
    return `${this.uploadBlob(blobName).url}?${sas}`;
  }

  private uploadBlob(blobName: string): BlockBlobClient {
    return this.client.getContainerClient(this.uploadContainer).getBlockBlobClient(blobName);
  }

  private publicBlob(blobName: string): BlockBlobClient {
    return this.client.getContainerClient(this.publicContainer).getBlockBlobClient(blobName);
  }

  private get client(): BlobServiceClient {
    if (!this.serviceClient) {
      this.serviceClient = new BlobServiceClient(
        `https://${this.accountName}.blob.core.windows.net`,
        new DefaultAzureCredential()
      );
    }
    return this.serviceClient;
  }

  private get accountName(): string {
    return this.required("AZURE_STORAGE_ACCOUNT_NAME");
  }

  private get uploadContainer(): string {
    return this.required("AZURE_STORAGE_UPLOAD_CONTAINER_NAME");
  }

  private get publicContainer(): string {
    return this.required("AZURE_STORAGE_PUBLIC_CONTAINER_NAME");
  }

  private required(key: string): string {
    const value = this.config.get<string>(key, "");
    if (!value) throw new ApiException(503, "IMAGE_STORAGE_UNAVAILABLE", "Image storage is not configured.");
    return value;
  }
}
