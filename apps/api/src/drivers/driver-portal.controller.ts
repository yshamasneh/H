import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import {
  DeliveriesPaginationQueryDto,
  DriverCashSummaryQueryDto,
  ReportPresenceDto,
  SetDriverOnlineStatusDto,
  UpdateDeliveryStatusDto,
  UpdateDriverLocationDto
} from "./drivers.dto";
import { DriversService } from "./drivers.service";

@ApiTags("driver-portal")
@ApiBearerAuth()
@Controller("driver")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DRIVER)
export class DriverPortalController {
  constructor(private readonly drivers: DriversService) {}

  @Get("me")
  @ApiOperation({ summary: "The driver's own profile, including whether they are currently on shift (online)" })
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.drivers.getOwnProfile(request.user.id);
  }

  @Patch("me/status")
  @ApiOperation({ summary: "Toggle whether the driver is online and available for deliveries" })
  setStatus(@Req() request: AuthenticatedRequest, @Body() input: SetDriverOnlineStatusDto) {
    return this.drivers.setOnlineStatus(request.user.id, input.isOnline);
  }

  @Put("me/presence")
  @ApiOperation({
    summary:
      "Report that the app is open (FOREGROUND, a heartbeat), has gone to the background, or is closed. Alerts are sent only while this lease is valid and the driver is online."
  })
  reportPresence(@Req() request: AuthenticatedRequest, @Body() input: ReportPresenceDto) {
    return this.drivers.reportPresence(request.user.id, input.state);
  }

  @Patch("me/location")
  @ApiOperation({ summary: "Report the driver's current GPS location (shown to dispatch/admin)" })
  updateLocation(@Req() request: AuthenticatedRequest, @Body() input: UpdateDriverLocationDto) {
    return this.drivers.updateLocation(request.user.id, input.latitude, input.longitude);
  }

  @Get("me/stats")
  @ApiOperation({ summary: "Completed-delivery count and earnings for the authenticated driver" })
  getStats(@Req() request: AuthenticatedRequest) {
    return this.drivers.getOwnStats(request.user.id);
  }

  @Get("me/cash-summary")
  @ApiOperation({
    summary:
      "Cash collected, delivery earnings and cash still owed to the platform — three separate figures read from the accounting ledger, for a chosen period"
  })
  getCashSummary(@Req() request: AuthenticatedRequest, @Query() query: DriverCashSummaryQueryDto) {
    return this.drivers.getOwnCashSummary(request.user.id, query.period ?? "SHIFT");
  }

  @Get("me/cash-handovers")
  @ApiOperation({
    summary:
      "The driver's settled periods, newest first: each span between cash handovers with what was handed over, counted and earned. Read-only history; the main cash screen shows only the current period."
  })
  getHandoverHistory(@Req() request: AuthenticatedRequest) {
    return this.drivers.getOwnHandoverHistory(request.user.id);
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

  @Get("me/deliveries/:deliveryId/route")
  @ApiOperation({ summary: "The road route from the pickup store to the customer for one of the driver's own deliveries" })
  getRoute(@Req() request: AuthenticatedRequest, @Param("deliveryId", new ParseUUIDPipe()) deliveryId: string) {
    return this.drivers.getDeliveryRoute(request.user.id, deliveryId);
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
