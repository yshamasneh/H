import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { CreateLandmarkDto, UpdateLandmarkDto } from "./landmarks.dto";
import { LandmarksService } from "./landmarks.service";

@ApiTags("admin-landmarks")
@ApiBearerAuth()
@Controller("admin/landmarks")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_LANDMARKS")
export class AdminLandmarksController {
  constructor(private readonly landmarks: LandmarksService) {}

  @Get()
  @ApiOperation({ summary: "List every orientation landmark" })
  list() {
    return this.landmarks.list();
  }

  @Post()
  @ApiOperation({ summary: "Create a public orientation landmark" })
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateLandmarkDto) {
    return this.landmarks.create(request.user.id, input);
  }

  @Patch(":landmarkId")
  @ApiOperation({ summary: "Update a landmark's name or coordinates" })
  update(
    @Req() request: AuthenticatedRequest,
    @Param("landmarkId", new ParseUUIDPipe()) landmarkId: string,
    @Body() input: UpdateLandmarkDto
  ) {
    return this.landmarks.update(request.user.id, landmarkId, input);
  }

  @Delete(":landmarkId")
  @ApiOperation({ summary: "Delete a landmark" })
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("landmarkId", new ParseUUIDPipe()) landmarkId: string
  ) {
    return this.landmarks.delete(request.user.id, landmarkId);
  }
}
