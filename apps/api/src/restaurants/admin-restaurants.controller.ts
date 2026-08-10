import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { UserRole } from "../generated/prisma/client";
import { AdminRestaurantsQueryDto, RestaurantAdminActionReasonDto } from "./restaurants.dto";
import { RestaurantsService } from "./restaurants.service";
import { OrdersPaginationQueryDto } from "../orders/orders.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/restaurants")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_BUSINESSES")
export class AdminRestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  @ApiOperation({ summary: "List restaurants, optionally filtered by status and open/closed" })
  list(@Query() query: AdminRestaurantsQueryDto) {
    return this.restaurants.adminList(query);
  }

  @Get(":restaurantId")
  @ApiOperation({ summary: "Get a restaurant's admin profile, including order-count and revenue stats" })
  getOne(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.adminGetRestaurant(restaurantId);
  }

  @Get(":restaurantId/menu")
  @ApiOperation({ summary: "Get a restaurant's full menu, including inactive categories and unavailable items" })
  getMenu(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.adminGetRestaurantMenu(restaurantId);
  }

  @Get(":restaurantId/orders")
  @ApiOperation({ summary: "List a restaurant's order history" })
  getOrders(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string, @Query() query: OrdersPaginationQueryDto) {
    return this.restaurants.adminListRestaurantOrders(restaurantId, query.page ?? 1, query.pageSize ?? 20);
  }

  @Post(":restaurantId/approve")
  @ApiOperation({ summary: "Approve a pending restaurant" })
  approve(@Req() request: AuthenticatedRequest, @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.approve(request.user.id, restaurantId);
  }

  @Post(":restaurantId/reject")
  @ApiOperation({ summary: "Reject a pending restaurant" })
  reject(@Req() request: AuthenticatedRequest, @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.reject(request.user.id, restaurantId);
  }

  @Post(":restaurantId/suspend")
  @ApiOperation({ summary: "Suspend an approved restaurant (also closes it to new orders)" })
  suspend(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: RestaurantAdminActionReasonDto
  ) {
    return this.restaurants.adminSuspend(request.user.id, restaurantId, input.reason);
  }

  @Post(":restaurantId/reactivate")
  @ApiOperation({ summary: "Reactivate a suspended restaurant" })
  reactivate(@Req() request: AuthenticatedRequest, @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.adminReactivate(request.user.id, restaurantId);
  }
}
