import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { AdminOrdersFilterDto, CancelOrderReasonDto } from "./orders.dto";
import { OrdersService } from "./orders.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/orders")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("VIEW_ALL_ORDERS")
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "List every order, filterable by status, restaurant, customer, and date range" })
  list(@Query() query: AdminOrdersFilterDto) {
    return this.orders.adminListOrders(query, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get(":orderId")
  @ApiOperation({ summary: "Get any order's full detail, including status history and delivery" })
  getOne(@Param("orderId", new ParseUUIDPipe()) orderId: string) {
    return this.orders.adminGetOrder(orderId);
  }

  @Post(":orderId/cancel")
  @RequirePermission("MANAGE_ALL_ORDERS")
  @ApiOperation({ summary: "Cancel a stuck order as an administrator, with a required reason" })
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Body() input: CancelOrderReasonDto
  ) {
    return this.orders.adminCancelOrder(request.user.id, orderId, input.reason);
  }
}
