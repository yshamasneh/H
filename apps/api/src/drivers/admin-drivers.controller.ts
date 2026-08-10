import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { UserRole } from "../generated/prisma/client";
import { AdminActionReasonDto } from "./drivers.dto";
import { DriversService } from "./drivers.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/drivers")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_DRIVERS")
export class AdminDriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @ApiOperation({ summary: "List every driver with approval status, online status, and delivery stats" })
  list() {
    return this.drivers.adminListDrivers();
  }

  @Post(":driverUserId/approve")
  @ApiOperation({ summary: "Approve a pending driver application" })
  approve(@Req() request: AuthenticatedRequest, @Param("driverUserId", new ParseUUIDPipe()) driverUserId: string) {
    return this.drivers.adminApprove(request.user.id, driverUserId);
  }

  @Post(":driverUserId/reject")
  @ApiOperation({ summary: "Reject a pending driver application" })
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("driverUserId", new ParseUUIDPipe()) driverUserId: string,
    @Body() input: AdminActionReasonDto
  ) {
    return this.drivers.adminReject(request.user.id, driverUserId, input.reason);
  }

  @Post(":driverUserId/suspend")
  @ApiOperation({ summary: "Suspend an approved driver" })
  suspend(
    @Req() request: AuthenticatedRequest,
    @Param("driverUserId", new ParseUUIDPipe()) driverUserId: string,
    @Body() input: AdminActionReasonDto
  ) {
    return this.drivers.adminSuspend(request.user.id, driverUserId, input.reason);
  }

  @Post(":driverUserId/reactivate")
  @ApiOperation({ summary: "Reactivate a suspended driver" })
  reactivate(@Req() request: AuthenticatedRequest, @Param("driverUserId", new ParseUUIDPipe()) driverUserId: string) {
    return this.drivers.adminReactivate(request.user.id, driverUserId);
  }
}
