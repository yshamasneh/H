import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { BlobImageStorageService } from "./blob-image-storage.service";
import { ManagedImageUrlService } from "./managed-image-url.service";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [UploadsController],
  providers: [UploadsService, BlobImageStorageService, ManagedImageUrlService, JwtAuthGuard, RolesGuard],
  exports: [ManagedImageUrlService]
})
export class UploadsModule {}
