import type { InventoryMovementType, Prisma } from "../generated/prisma/client";

export async function writeInventoryMovement(
  tx: Prisma.TransactionClient,
  input: {
    restaurantId: string;
    menuItemId: string;
    actorUserId?: string | null;
    orderId?: string | null;
    type: InventoryMovementType;
    quantityDelta: number;
    stockAfter: number;
    reason?: string | null;
  }
): Promise<void> {
  await tx.inventoryMovement.create({
    data: {
      restaurantId: input.restaurantId,
      menuItemId: input.menuItemId,
      actorUserId: input.actorUserId ?? null,
      orderId: input.orderId ?? null,
      type: input.type,
      quantityDelta: input.quantityDelta,
      stockAfter: input.stockAfter,
      reason: input.reason?.trim() || null
    }
  });
}
