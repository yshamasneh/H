import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { OrdersPaginationQueryDto } from "./orders.dto";
import { OrdersService } from "./orders.service";

@ApiTags("restaurant-portal")
@ApiBearerAuth()
@Controller("restaurant/me/orders")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RESTAURANT)
export class RestaurantOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "List the authenticated restaurant's incoming orders, most recent first" })
  list(@Req() request: AuthenticatedRequest, @Query() query: OrdersPaginationQueryDto) {
    return this.orders.listForRestaurantOwner(request.user.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get(":orderId")
  @ApiOperation({ summary: "Get a single order belonging to the authenticated restaurant" })
  getOne(@Req() request: AuthenticatedRequest, @Param("orderId", new ParseUUIDPipe()) orderId: string) {
    return this.orders.getForRestaurantOwner(request.user.id, orderId);
  }
}
