import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import {
  OrdersPaginationQueryDto,
  ProposeFulfillmentAdjustmentDto,
  SetOrderItemPickedDto,
  UpdateOrderStatusDto
} from "./orders.dto";
import { OrdersService } from "./orders.service";

@ApiTags("restaurant-portal")
@ApiBearerAuth()
@Controller("restaurant/me/orders")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.RESTAURANT)
@RequirePermission("VIEW_ORDERS")
export class RestaurantOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "List the authenticated restaurant's incoming orders, most recent first" })
  list(@Req() request: AuthenticatedRequest, @Query() query: OrdersPaginationQueryDto) {
    return this.orders.listForRestaurantOwner(request.user.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get("live")
  @ApiOperation({ summary: "The operational order queue grouped into new, in progress, and ready" })
  live(@Req() request: AuthenticatedRequest) {
    return this.orders.listLiveForBusiness(request.user.id);
  }

  @Get(":orderId")
  @ApiOperation({ summary: "Get a single order belonging to the authenticated restaurant" })
  getOne(@Req() request: AuthenticatedRequest, @Param("orderId", new ParseUUIDPipe()) orderId: string) {
    return this.orders.getForRestaurantOwner(request.user.id, orderId);
  }

  @Post(":orderId/items/:orderItemId/fulfillment")
  @RequirePermission("MANAGE_ORDERS")
  @ApiOperation({ summary: "Propose a supermarket replacement or packed variable quantity for customer review" })
  proposeFulfillment(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Param("orderItemId", new ParseUUIDPipe()) orderItemId: string,
    @Body() input: ProposeFulfillmentAdjustmentDto
  ) {
    return this.orders.proposeFulfillmentAdjustment(request.user.id, orderId, orderItemId, input);
  }

  @Put(":orderId/items/:orderItemId/picked")
  @RequirePermission("MANAGE_ORDERS")
  @ApiOperation({ summary: "Mark one line of an order being packed as in the bag (or not), shared by every device on the business" })
  setItemPicked(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Param("orderItemId", new ParseUUIDPipe()) orderItemId: string,
    @Body() input: SetOrderItemPickedDto
  ) {
    return this.orders.setItemPicked(request.user.id, orderId, orderItemId, input.isPicked);
  }

  @Patch(":orderId/status")
  @RequirePermission("MANAGE_ORDERS")
  @ApiOperation({ summary: "Accept, reject, or advance the status of an order belonging to the authenticated restaurant" })
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() input: UpdateOrderStatusDto
  ) {
    return this.orders.updateStatusForRestaurantOwner(request.user.id, orderId, input.status, input.note);
  }
}
