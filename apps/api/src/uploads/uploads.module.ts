import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { BlobImageStorageService } from "./blob-image-storage.service";
import { ImageStorage } from "./image-storage";
import { ManagedImageUrlService } from "./managed-image-url.service";
import { S3ImageStorageService } from "./s3-image-storage.service";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

export function createImageStorage(config: ConfigService): ImageStorage {
  return config.get<string>("IMAGE_STORAGE_DRIVER", "azure") === "s3"
    ? new S3ImageStorageService(config)
    : new BlobImageStorageService(config);
}

@Module({
  imports: [JwtModule.register({})],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    { provide: ImageStorage, useFactory: createImageStorage, inject: [ConfigService] },
    ManagedImageUrlService,
    JwtAuthGuard,
    RolesGuard
  ],
  exports: [ManagedImageUrlService]
})
export class UploadsModule {}
