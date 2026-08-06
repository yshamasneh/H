import { Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsPaginationQueryDto } from "./notifications.dto";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("me")
  @ApiOperation({ summary: "List the authenticated user's own notifications, most recent first" })
  listMine(@Req() request: AuthenticatedRequest, @Query() query: NotificationsPaginationQueryDto) {
    return this.notifications.listForUser(request.user.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Patch(":notificationId/read")
  @ApiOperation({ summary: "Mark one of the authenticated user's own notifications as read" })
  markRead(@Req() request: AuthenticatedRequest, @Param("notificationId", new ParseUUIDPipe()) notificationId: string) {
    return this.notifications.markRead(request.user.id, notificationId);
  }
}
