import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import {
  ProposeFulfillmentAdjustmentDto,
  SetOrderItemPickedDto,
  UpdateOrderStatusDto
} from "./orders.dto";
import { OrdersService } from "./orders.service";

/**
 * A platform admin running a store's order counter from the admin console: the live board, an
 * order's detail, accept / reject / advance, the packing checklist, and supermarket fulfillment
 * proposals. Identical service calls to the store's own /restaurant/me/orders routes, with the store
 * named by id and the admin recorded as the actor; changing an order also needs MANAGE_ALL_ORDERS.
 * The paginated order list stays on AdminRestaurantsController (GET :restaurantId/orders).
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/restaurants/:restaurantId/orders")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_BUSINESSES")
export class AdminStoreOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get("live")
  @ApiOperation({ summary: "The operational order queue grouped into new, in progress, and ready" })
  live(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string
  ) {
    return this.orders.listLiveForBusiness(asStore(request, restaurantId));
  }

  @Get(":orderId")
  @ApiOperation({ summary: "Get a single order belonging to this store" })
  getOne(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string
  ) {
    return this.orders.getForRestaurantOwner(asStore(request, restaurantId), orderId);
  }

  @Post(":orderId/items/:orderItemId/fulfillment")
  @RequirePermission("MANAGE_BUSINESSES", "MANAGE_ALL_ORDERS")
  @ApiOperation({ summary: "Propose a supermarket replacement or packed variable quantity for customer review" })
  proposeFulfillment(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Param("orderItemId", new ParseUUIDPipe()) orderItemId: string,
    @Body() input: ProposeFulfillmentAdjustmentDto
  ) {
    return this.orders.proposeFulfillmentAdjustment(asStore(request, restaurantId), orderId, orderItemId, input);
  }

  @Put(":orderId/items/:orderItemId/picked")
  @RequirePermission("MANAGE_BUSINESSES", "MANAGE_ALL_ORDERS")
  @ApiOperation({ summary: "Mark one line of an order being packed as in the bag (or not), shared by every device on the business (and the admin console)" })
  setItemPicked(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Param("orderItemId", new ParseUUIDPipe()) orderItemId: string,
    @Body() input: SetOrderItemPickedDto
  ) {
    return this.orders.setItemPicked(asStore(request, restaurantId), orderId, orderItemId, input.isPicked);
  }

  @Patch(":orderId/status")
  @RequirePermission("MANAGE_BUSINESSES", "MANAGE_ALL_ORDERS")
  @ApiOperation({ summary: "Accept, reject, or advance the status of an order belonging to this store" })
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() input: UpdateOrderStatusDto
  ) {
    return this.orders.updateStatusForRestaurantOwner(asStore(request, restaurantId), orderId, input.status, input.note);
  }
}

/** The store this admin route names, with the admin as the actor on every record it writes. */
function asStore(request: AuthenticatedRequest, restaurantId: string) {
  return { actorUserId: request.user.id, businessId: restaurantId };
}
