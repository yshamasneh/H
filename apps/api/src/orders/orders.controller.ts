import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { CreateOrderDto, OrdersPaginationQueryDto } from "./orders.dto";
import { OrdersService } from "./orders.service";

@ApiTags("orders")
@ApiBearerAuth()
@Controller("orders")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({ summary: "Place an order from a single restaurant's cart" })
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateOrderDto) {
    return this.orders.createOrder(request.user.id, input);
  }

  @Get("me")
  @ApiOperation({ summary: "List the authenticated customer's own orders, most recent first" })
  listMine(@Req() request: AuthenticatedRequest, @Query() query: OrdersPaginationQueryDto) {
    return this.orders.listForCustomer(request.user.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get(":orderId")
  @ApiOperation({ summary: "Get a single order belonging to the authenticated customer" })
  getOne(@Req() request: AuthenticatedRequest, @Param("orderId", new ParseUUIDPipe()) orderId: string) {
    return this.orders.getForCustomer(request.user.id, orderId);
  }
}
