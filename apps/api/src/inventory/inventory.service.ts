import { Injectable } from "@nestjs/common";
import { writeAuditLog } from "../common/audit-log.util";
import { resolveMemberBusinessId } from "../common/authorization/business-scope.util";
import { ApiException } from "../common/api.exception";
import {
  BusinessType,
  InventoryMovementType,
  PurchaseOrderStatus,
  type MenuItem,
  type Prisma
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AdjustInventoryDto,
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  InventoryMovementQueryDto,
  InventoryQueryDto
} from "./inventory.dto";
import { writeInventoryMovement } from "./inventory.util";

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listInventory(ownerUserId: string, query: InventoryQueryDto) {
    const store = await this.requireSupermarket(ownerUserId);
    const search = query.search?.trim();
    const items = await this.prisma.menuItem.findMany({
      where: {
        restaurantId: store.id,
        ...(search ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
            { barcode: { contains: search, mode: "insensitive" } },
            { brand: { contains: search, mode: "insensitive" } }
          ]
        } : {})
      },
      orderBy: { name: "asc" }
    });
    const tracked = items.filter((item) => item.stockQuantity !== null);
    const lowStockItems = tracked.filter((item) =>
      item.reorderLevel !== null && item.stockQuantity! <= item.reorderLevel
    );
    const filtered = query.lowStock ? lowStockItems : items;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    return {
      summary: {
        totalProducts: items.length,
        trackedProducts: tracked.length,
        lowStockProducts: lowStockItems.length,
        outOfStockProducts: tracked.filter((item) => item.stockQuantity === 0).length
      },
      items: filtered.slice((page - 1) * pageSize, page * pageSize).map(toInventoryItem),
      page,
      pageSize,
      total: filtered.length
    };
  }

  async lookupBarcode(ownerUserId: string, barcode: string) {
    const store = await this.requireSupermarket(ownerUserId);
    const item = await this.prisma.menuItem.findFirst({ where: { restaurantId: store.id, barcode: barcode.trim() } });
    if (!item) throw new ApiException(404, "INVENTORY_BARCODE_NOT_FOUND", "No product in this store uses this barcode.");
    return toInventoryItem(item);
  }

  async adjust(ownerUserId: string, itemId: string, input: AdjustInventoryDto) {
    if (input.quantityDelta === 0) {
      throw new ApiException(400, "INVENTORY_DELTA_REQUIRED", "Inventory adjustment must be greater or less than zero.");
    }
    const store = await this.requireSupermarket(ownerUserId);
    return this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnItem(tx, store.id, itemId);
      const nextStock = (item.stockQuantity ?? 0) + input.quantityDelta;
      if (nextStock < 0) throw new ApiException(409, "INVENTORY_NEGATIVE_STOCK", "This adjustment would make stock negative.");
      const changed = await tx.menuItem.updateMany({
        where: { id: item.id, stockQuantity: item.stockQuantity },
        data: { stockQuantity: nextStock }
      });
      if (changed.count !== 1) {
        throw new ApiException(409, "INVENTORY_CHANGED", "Stock changed while this adjustment was being saved. Refresh and try again.");
      }
      const updated = await tx.menuItem.findUnique({ where: { id: item.id } });
      await writeInventoryMovement(tx, {
        restaurantId: store.id,
        menuItemId: item.id,
        actorUserId: ownerUserId,
        type: InventoryMovementType.MANUAL_ADJUSTMENT,
        quantityDelta: input.quantityDelta,
        stockAfter: nextStock,
        reason: input.reason
      });
      await writeAuditLog(tx, {
        actorUserId: ownerUserId,
        action: "INVENTORY_MANUALLY_ADJUSTED",
        entityType: "MenuItem",
        entityId: item.id,
        reason: input.reason,
        metadata: { quantityDelta: input.quantityDelta, stockAfter: nextStock }
      });
      return toInventoryItem(updated!);
    });
  }

  async listMovements(ownerUserId: string, query: InventoryMovementQueryDto) {
    const store = await this.requireSupermarket(ownerUserId);
    const where = { restaurantId: store.id, menuItemId: query.menuItemId };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const [items, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: { menuItem: { select: { name: true, sku: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.inventoryMovement.count({ where })
    ]);
    return { items, page, pageSize, total };
  }

  async listSuppliers(ownerUserId: string) {
    const store = await this.requireSupermarket(ownerUserId);
    return this.prisma.supplier.findMany({ where: { restaurantId: store.id }, orderBy: { name: "asc" } });
  }

  async createSupplier(ownerUserId: string, input: CreateSupplierDto) {
    const store = await this.requireSupermarket(ownerUserId);
    return this.prisma.supplier.create({
      data: {
        restaurantId: store.id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        note: input.note?.trim() || null
      }
    });
  }

  async listPurchaseOrders(ownerUserId: string) {
    const store = await this.requireSupermarket(ownerUserId);
    return this.prisma.purchaseOrder.findMany({
      where: { restaurantId: store.id },
      include: { supplier: true, items: { include: { menuItem: { select: { name: true, sku: true } } } } },
      orderBy: { createdAt: "desc" }
    });
  }

  async createPurchaseOrder(ownerUserId: string, input: CreatePurchaseOrderDto) {
    const store = await this.requireSupermarket(ownerUserId);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.restaurantId !== store.id || !supplier.isActive) {
      throw new ApiException(404, "SUPPLIER_NOT_FOUND", "This active supplier does not belong to your store.");
    }
    const uniqueItemIds = new Set(input.items.map((item) => item.menuItemId));
    if (uniqueItemIds.size !== input.items.length) {
      throw new ApiException(400, "PURCHASE_ORDER_DUPLICATE_ITEM", "A purchase order cannot contain the same product twice.");
    }
    const products = await this.prisma.menuItem.findMany({ where: { id: { in: [...uniqueItemIds] }, restaurantId: store.id } });
    if (products.length !== uniqueItemIds.size) {
      throw new ApiException(400, "PURCHASE_ORDER_ITEM_INVALID", "Every purchase item must belong to your store.");
    }
    const totalCostMinor = input.items.reduce((sum, item) => sum + item.quantity * item.unitCostMinor, 0);
    return this.prisma.purchaseOrder.create({
      data: {
        restaurantId: store.id,
        supplierId: supplier.id,
        createdByUserId: ownerUserId,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        totalCostMinor,
        items: { create: input.items }
      },
      include: { supplier: true, items: { include: { menuItem: { select: { name: true, sku: true } } } } }
    });
  }

  async receivePurchaseOrder(ownerUserId: string, purchaseOrderId: string) {
    const store = await this.requireSupermarket(ownerUserId);
    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { supplier: true, items: { include: { menuItem: true } } }
      });
      if (!purchaseOrder || purchaseOrder.restaurantId !== store.id) {
        throw new ApiException(404, "PURCHASE_ORDER_NOT_FOUND", "This purchase order does not belong to your store.");
      }
      if (purchaseOrder.status !== PurchaseOrderStatus.DRAFT) {
        throw new ApiException(409, "PURCHASE_ORDER_NOT_DRAFT", "Only a draft purchase order can be received.");
      }
      const changed = await tx.purchaseOrder.updateMany({
        where: { id: purchaseOrder.id, status: PurchaseOrderStatus.DRAFT },
        data: { status: PurchaseOrderStatus.RECEIVED, receivedAt: new Date() }
      });
      if (changed.count !== 1) throw new ApiException(409, "PURCHASE_ORDER_NOT_DRAFT", "This purchase order was already processed.");
      for (const line of purchaseOrder.items) {
        const stockChanged = line.menuItem.stockQuantity === null
          ? await tx.menuItem.updateMany({
              where: { id: line.menuItemId, stockQuantity: null },
              data: { stockQuantity: line.quantity }
            })
          : await tx.menuItem.updateMany({
              where: { id: line.menuItemId, stockQuantity: { not: null } },
              data: { stockQuantity: { increment: line.quantity } }
            });
        if (stockChanged.count !== 1) {
          throw new ApiException(409, "INVENTORY_CHANGED", "Stock tracking changed while this purchase was being received. Refresh and try again.");
        }
        const receivedItem = await tx.menuItem.findUnique({ where: { id: line.menuItemId } });
        const stockAfter = receivedItem!.stockQuantity!;
        await writeInventoryMovement(tx, {
          restaurantId: store.id,
          menuItemId: line.menuItemId,
          actorUserId: ownerUserId,
          type: InventoryMovementType.PURCHASE_RECEIPT,
          quantityDelta: line.quantity,
          stockAfter,
          reason: `Purchase order ${purchaseOrder.reference ?? purchaseOrder.id}`
        });
      }
      await writeAuditLog(tx, {
        actorUserId: ownerUserId,
        action: "PURCHASE_ORDER_RECEIVED",
        entityType: "PurchaseOrder",
        entityId: purchaseOrder.id,
        metadata: { supplierId: purchaseOrder.supplierId, totalCostMinor: purchaseOrder.totalCostMinor }
      });
      return tx.purchaseOrder.findUnique({
        where: { id: purchaseOrder.id },
        include: { supplier: true, items: { include: { menuItem: { select: { name: true, sku: true } } } } }
      });
    });
  }

  async cancelPurchaseOrder(ownerUserId: string, purchaseOrderId: string) {
    const store = await this.requireSupermarket(ownerUserId);
    const changed = await this.prisma.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, restaurantId: store.id, status: PurchaseOrderStatus.DRAFT },
      data: { status: PurchaseOrderStatus.CANCELLED }
    });
    if (changed.count !== 1) {
      throw new ApiException(409, "PURCHASE_ORDER_NOT_DRAFT", "Only an existing draft purchase order can be cancelled.");
    }
    return this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { supplier: true, items: { include: { menuItem: { select: { name: true, sku: true } } } } }
    });
  }

  /** Resolves the caller's business from their membership, so staff accounts work, not just owners. */
  private async requireSupermarket(memberUserId: string) {
    const businessId = await resolveMemberBusinessId(this.prisma, memberUserId);
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: businessId } });
    if (!restaurant || restaurant.businessType !== BusinessType.SUPERMARKET) {
      throw new ApiException(404, "SUPERMARKET_NOT_FOUND", "Inventory operations are available only to supermarket owners.");
    }
    return restaurant;
  }

  private async requireOwnItem(tx: Prisma.TransactionClient, restaurantId: string, itemId: string): Promise<MenuItem> {
    const item = await tx.menuItem.findUnique({ where: { id: itemId } });
    if (!item || item.restaurantId !== restaurantId) {
      throw new ApiException(404, "MENU_ITEM_NOT_FOUND", "This product does not belong to your store.");
    }
    return item;
  }
}

function toInventoryItem(item: MenuItem) {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    barcode: item.barcode,
    stockQuantity: item.stockQuantity,
    reorderLevel: item.reorderLevel,
    unitLabel: item.unitLabel,
    isAvailable: item.isAvailable,
    isLowStock: item.stockQuantity !== null && item.reorderLevel !== null && item.stockQuantity <= item.reorderLevel
  };
}
