import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import {
  AdjustInventoryDto,
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  InventoryMovementQueryDto,
  InventoryQueryDto
} from "./inventory.dto";
import { InventoryService } from "./inventory.service";

@ApiTags("supermarket-inventory")
@ApiBearerAuth()
@Controller("restaurant/me/inventory")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.RESTAURANT)
@RequirePermission("MANAGE_INVENTORY")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: "List supermarket inventory and low-stock counts" })
  list(@Req() request: AuthenticatedRequest, @Query() query: InventoryQueryDto) {
    return this.inventory.listInventory(request.user.id, query);
  }

  @Get("movements")
  @ApiOperation({ summary: "List the immutable inventory movement ledger" })
  movements(@Req() request: AuthenticatedRequest, @Query() query: InventoryMovementQueryDto) {
    return this.inventory.listMovements(request.user.id, query);
  }

  @Get("barcode/:barcode")
  @ApiOperation({ summary: "Look up a supermarket product by barcode" })
  barcode(@Req() request: AuthenticatedRequest, @Param("barcode") barcode: string) {
    return this.inventory.lookupBarcode(request.user.id, barcode);
  }

  @Post("items/:itemId/adjust")
  @ApiOperation({ summary: "Apply a reasoned manual stock adjustment" })
  adjust(
    @Req() request: AuthenticatedRequest,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() input: AdjustInventoryDto
  ) {
    return this.inventory.adjust(request.user.id, itemId, input);
  }

  @Get("suppliers")
  listSuppliers(@Req() request: AuthenticatedRequest) {
    return this.inventory.listSuppliers(request.user.id);
  }

  @Post("suppliers")
  createSupplier(@Req() request: AuthenticatedRequest, @Body() input: CreateSupplierDto) {
    return this.inventory.createSupplier(request.user.id, input);
  }

  @Get("purchase-orders")
  listPurchaseOrders(@Req() request: AuthenticatedRequest) {
    return this.inventory.listPurchaseOrders(request.user.id);
  }

  @Post("purchase-orders")
  createPurchaseOrder(@Req() request: AuthenticatedRequest, @Body() input: CreatePurchaseOrderDto) {
    return this.inventory.createPurchaseOrder(request.user.id, input);
  }

  @Post("purchase-orders/:purchaseOrderId/receive")
  receivePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("purchaseOrderId", new ParseUUIDPipe()) purchaseOrderId: string
  ) {
    return this.inventory.receivePurchaseOrder(request.user.id, purchaseOrderId);
  }

  @Post("purchase-orders/:purchaseOrderId/cancel")
  cancelPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("purchaseOrderId", new ParseUUIDPipe()) purchaseOrderId: string
  ) {
    return this.inventory.cancelPurchaseOrder(request.user.id, purchaseOrderId);
  }
}
