import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { BroadcastNotificationDto } from "./notifications.dto";
import { NotificationsService } from "./notifications.service";

@ApiTags("admin-notifications")
@ApiBearerAuth()
@Controller("admin/notifications")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_NOTIFICATIONS")
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post("broadcast")
  @ApiOperation({ summary: "Send a one-off message to every active account of one role" })
  broadcast(@Body() input: BroadcastNotificationDto) {
    return this.notifications.broadcast(input.audience, input.title, input.body);
  }
}
