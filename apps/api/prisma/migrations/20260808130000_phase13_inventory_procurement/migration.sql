CREATE TYPE "InventoryMovementType" AS ENUM (
    'ORDER_RESERVATION',
    'ORDER_RESTORE',
    'FULFILLMENT_RESERVATION',
    'FULFILLMENT_RELEASE',
    'MANUAL_ADJUSTMENT',
    'PURCHASE_RECEIPT'
);
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

ALTER TABLE "MenuItem"
ADD COLUMN "barcode" TEXT,
ADD COLUMN "reorderLevel" INTEGER,
ADD CONSTRAINT "MenuItem_reorderLevel_check" CHECK ("reorderLevel" IS NULL OR "reorderLevel" >= 0);

CREATE UNIQUE INDEX "MenuItem_restaurantId_barcode_key" ON "MenuItem"("restaurantId", "barcode");

CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "actorUserId" UUID,
    "orderId" UUID,
    "type" "InventoryMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryMovement_nonzero_delta_check" CHECK ("quantityDelta" <> 0),
    CONSTRAINT "InventoryMovement_stockAfter_check" CHECK ("stockAfter" >= 0)
);

CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "reference" TEXT,
    "note" TEXT,
    "totalCostMinor" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseOrder_totalCostMinor_check" CHECK ("totalCostMinor" >= 0)
);

CREATE TABLE "PurchaseOrderItem" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostMinor" INTEGER NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseOrderItem_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "PurchaseOrderItem_unitCostMinor_check" CHECK ("unitCostMinor" >= 0)
);

CREATE INDEX "InventoryMovement_restaurantId_createdAt_idx" ON "InventoryMovement"("restaurantId", "createdAt");
CREATE INDEX "InventoryMovement_menuItemId_createdAt_idx" ON "InventoryMovement"("menuItemId", "createdAt");
CREATE INDEX "InventoryMovement_orderId_idx" ON "InventoryMovement"("orderId");
CREATE INDEX "Supplier_restaurantId_isActive_name_idx" ON "Supplier"("restaurantId", "isActive", "name");
CREATE INDEX "PurchaseOrder_restaurantId_status_createdAt_idx" ON "PurchaseOrder"("restaurantId", "status", "createdAt");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_menuItemId_key" ON "PurchaseOrderItem"("purchaseOrderId", "menuItemId");
CREATE INDEX "PurchaseOrderItem_menuItemId_idx" ON "PurchaseOrderItem"("menuItemId");

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
