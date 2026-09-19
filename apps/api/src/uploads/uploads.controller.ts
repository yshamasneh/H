import { Body, Controller, Delete, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { CompleteImageUploadDto, CreateImageUploadUrlDto, DeleteUploadedImageDto } from "./uploads.dto";
import { UploadsService } from "./uploads.service";

@ApiTags("uploads")
@ApiBearerAuth()
@Controller("uploads")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.RESTAURANT)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post("image-upload-url")
  @ApiOperation({ summary: "Issue a five-minute, write-only SAS for one generated staging blob" })
  createUploadUrl(@Req() request: AuthenticatedRequest, @Body() input: CreateImageUploadUrlDto) {
    return this.uploads.createUploadUrl(request.user, input);
  }

  @Post("complete")
  @ApiOperation({ summary: "Validate an uploaded blob and publish it at its final public URL" })
  complete(@Req() request: AuthenticatedRequest, @Body() input: CompleteImageUploadDto) {
    return this.uploads.complete(request.user, input);
  }

  @Delete("image")
  @ApiOperation({ summary: "Delete one managed image after its entity no longer references it" })
  deleteImage(@Req() request: AuthenticatedRequest, @Body() input: DeleteUploadedImageDto) {
    return this.uploads.deleteImage(request.user, input);
  }
}
