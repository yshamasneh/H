import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { DeliveriesPaginationQueryDto, SetDriverOnlineStatusDto, UpdateDeliveryStatusDto } from "./drivers.dto";
import { DriversService } from "./drivers.service";

@ApiTags("driver-portal")
@ApiBearerAuth()
@Controller("driver")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DRIVER)
export class DriverPortalController {
  constructor(private readonly drivers: DriversService) {}

  @Patch("me/status")
  @ApiOperation({ summary: "Toggle whether the driver is online and available for deliveries" })
  setStatus(@Req() request: AuthenticatedRequest, @Body() input: SetDriverOnlineStatusDto) {
    return this.drivers.setOnlineStatus(request.user.id, input.isOnline);
  }

  @Get("me/deliveries/available")
  @ApiOperation({ summary: "List unclaimed deliveries any online driver may accept" })
  listAvailable() {
    return this.drivers.listAvailableDeliveries();
  }

  @Get("me/deliveries")
  @ApiOperation({ summary: "List the authenticated driver's own current and past deliveries" })
  listMine(@Req() request: AuthenticatedRequest, @Query() query: DeliveriesPaginationQueryDto) {
    return this.drivers.listOwnDeliveries(request.user.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Post("me/deliveries/:deliveryId/accept")
  @ApiOperation({ summary: "Claim an unassigned delivery; only one driver can succeed per delivery" })
  accept(@Req() request: AuthenticatedRequest, @Param("deliveryId", new ParseUUIDPipe()) deliveryId: string) {
    return this.drivers.acceptDelivery(request.user.id, deliveryId);
  }

  @Patch("me/deliveries/:deliveryId/status")
  @ApiOperation({
    summary:
      "Advance a delivery through pickup, on-the-way, and delivered, or report it as failed with a reason"
  })
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param("deliveryId", new ParseUUIDPipe()) deliveryId: string,
    @Body() input: UpdateDeliveryStatusDto
  ) {
    return this.drivers.updateDeliveryStatus(request.user.id, deliveryId, input.status, {
      failureReason: input.failureReason,
      failureNote: input.failureNote
    });
  }
}
