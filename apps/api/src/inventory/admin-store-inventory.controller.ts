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

/**
 * A platform admin managing a supermarket's stock from the admin console: the same service calls as
 * the store's own /restaurant/me/inventory routes, with the store named by id and the admin recorded
 * as the actor on every movement, purchase order and audit entry.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/restaurants/:restaurantId/inventory")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_BUSINESSES")
export class AdminStoreInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: "List supermarket inventory and low-stock counts" })
  list(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Query() query: InventoryQueryDto
  ) {
    return this.inventory.listInventory(asStore(request, restaurantId), query);
  }

  @Get("movements")
  @ApiOperation({ summary: "List the immutable inventory movement ledger" })
  movements(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Query() query: InventoryMovementQueryDto
  ) {
    return this.inventory.listMovements(asStore(request, restaurantId), query);
  }

  @Get("barcode/:barcode")
  @ApiOperation({ summary: "Look up a supermarket product by barcode" })
  barcode(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("barcode") barcode: string
  ) {
    return this.inventory.lookupBarcode(asStore(request, restaurantId), barcode);
  }

  @Post("items/:itemId/adjust")
  @ApiOperation({ summary: "Apply a reasoned manual stock adjustment" })
  adjust(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() input: AdjustInventoryDto
  ) {
    return this.inventory.adjust(asStore(request, restaurantId), itemId, input);
  }

  @Get("suppliers")
  listSuppliers(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string
  ) {
    return this.inventory.listSuppliers(asStore(request, restaurantId));
  }

  @Post("suppliers")
  createSupplier(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: CreateSupplierDto
  ) {
    return this.inventory.createSupplier(asStore(request, restaurantId), input);
  }

  @Get("purchase-orders")
  listPurchaseOrders(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string
  ) {
    return this.inventory.listPurchaseOrders(asStore(request, restaurantId));
  }

  @Post("purchase-orders")
  createPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: CreatePurchaseOrderDto
  ) {
    return this.inventory.createPurchaseOrder(asStore(request, restaurantId), input);
  }

  @Post("purchase-orders/:purchaseOrderId/receive")
  receivePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("purchaseOrderId", new ParseUUIDPipe()) purchaseOrderId: string
  ) {
    return this.inventory.receivePurchaseOrder(asStore(request, restaurantId), purchaseOrderId);
  }

  @Post("purchase-orders/:purchaseOrderId/cancel")
  cancelPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("purchaseOrderId", new ParseUUIDPipe()) purchaseOrderId: string
  ) {
    return this.inventory.cancelPurchaseOrder(asStore(request, restaurantId), purchaseOrderId);
  }
}

/** The store this admin route names, with the admin as the actor on every record it writes. */
function asStore(request: AuthenticatedRequest, restaurantId: string) {
  return { actorUserId: request.user.id, businessId: restaurantId };
}
