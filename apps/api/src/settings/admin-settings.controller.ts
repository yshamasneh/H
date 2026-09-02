import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { UpdatePlatformSettingsDto } from "./settings.dto";
import { SettingsService } from "./settings.service";

@ApiTags("admin-settings")
@ApiBearerAuth()
@Controller("admin/settings")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_PLATFORM_SETTINGS")
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: "Read the platform-wide settings" })
  get() {
    return this.settings.get();
  }

  @Patch()
  @ApiOperation({ summary: "Update the platform-wide settings" })
  update(@Req() request: AuthenticatedRequest, @Body() input: UpdatePlatformSettingsDto) {
    return this.settings.update(request.user.id, input);
  }
}
