import { Injectable } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import type { MenuCategory, MenuItem } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto
} from "./restaurants.dto";
import type { MenuCategoryOwnerView, MenuItemOwnerView } from "./restaurants.types";

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(restaurantId: string): Promise<MenuCategoryOwnerView[]> {
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" }
    });
    return categories.map(toCategoryView);
  }

  async createCategory(restaurantId: string, input: CreateMenuCategoryDto): Promise<MenuCategoryOwnerView> {
    const name = input.name.trim();
    await this.assertCategoryNameAvailable(restaurantId, name);
    // An owner who does not care about ordering gets the next free slot, so two
    // categories never silently share a position; an explicit value is honoured
    // but must be unique.
    const sortOrder = input.sortOrder ?? (await this.nextCategorySortOrder(restaurantId));
    await this.assertCategorySortOrderAvailable(restaurantId, sortOrder);
    const category = await this.prisma.menuCategory.create({
      data: { restaurantId, name, sortOrder }
    });
    return toCategoryView(category);
  }

  async updateCategory(
    restaurantId: string,
    categoryId: string,
    input: UpdateMenuCategoryDto
  ): Promise<MenuCategoryOwnerView> {
    const category = await this.requireOwnCategory(restaurantId, categoryId);
    if (input.name !== undefined) {
      await this.assertCategoryNameAvailable(restaurantId, input.name.trim(), category.id);
    }
    if (input.sortOrder !== undefined) {
      await this.assertCategorySortOrderAvailable(restaurantId, input.sortOrder, category.id);
    }
    const updated = await this.prisma.menuCategory.update({
      where: { id: category.id },
      data: {
        name: input.name?.trim(),
        sortOrder: input.sortOrder,
        isActive: input.isActive
      }
    });
    return toCategoryView(updated);
  }

  async listItems(restaurantId: string): Promise<MenuItemOwnerView[]> {
    const items = await this.prisma.menuItem.findMany({
      where: { restaurantId },
      orderBy: { name: "asc" }
    });
    return items.map(toItemView);
  }

  async createItem(restaurantId: string, input: CreateMenuItemDto): Promise<MenuItemOwnerView> {
    await this.requireOwnCategory(restaurantId, input.categoryId);
    await this.assertSkuAvailable(restaurantId, input.sku);
    await this.assertBarcodeAvailable(restaurantId, input.barcode);
    const item = await this.prisma.menuItem.create({
      data: {
        restaurantId,
        categoryId: input.categoryId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        priceMinor: input.priceMinor,
        costPriceMinor: input.costPriceMinor ?? null,
        imageUrl: input.imageUrl || null,
        sku: input.sku?.trim() || null,
        brand: input.brand?.trim() || null,
        unitLabel: input.unitLabel?.trim() || "item",
        stockQuantity: input.stockQuantity ?? null,
        isFeatured: input.isFeatured ?? false,
        isVariableWeight: input.isVariableWeight ?? false,
        barcode: input.barcode?.trim() || null,
        reorderLevel: input.reorderLevel ?? null
      }
    });
    return toItemView(item);
  }

  async updateItem(
    restaurantId: string,
    itemId: string,
    input: UpdateMenuItemDto,
    capabilities: { canManagePrices: boolean }
  ): Promise<MenuItemOwnerView> {
    const item = await this.requireOwnItem(restaurantId, itemId);
    // MANAGE_PRODUCTS lets someone edit a product; changing what it costs — either the sale price
    // or the store's own cost price, which reveals margin — is a separate permission. Compared
    // against the stored value so resending an unchanged price is not treated as a price change —
    // a full edit form may always include the field.
    const changesPrice = input.priceMinor !== undefined && input.priceMinor !== item.priceMinor;
    const changesCostPrice = input.costPriceMinor !== undefined && input.costPriceMinor !== item.costPriceMinor;
    if ((changesPrice || changesCostPrice) && !capabilities.canManagePrices) {
      throw new ApiException(
        403,
        "FORBIDDEN_PERMISSION",
        "Your account does not have permission to change prices.",
        { requiredPermission: "MANAGE_PRICES" }
      );
    }
    if (input.categoryId) {
      await this.requireOwnCategory(restaurantId, input.categoryId);
    }
    await this.assertSkuAvailable(restaurantId, input.sku, item.id);
    await this.assertBarcodeAvailable(restaurantId, input.barcode, item.id);
    const updated = await this.prisma.menuItem.update({
      where: { id: item.id },
      data: {
        categoryId: input.categoryId,
        name: input.name?.trim(),
        description: input.description !== undefined ? input.description.trim() || null : undefined,
        priceMinor: input.priceMinor,
        costPriceMinor: input.costPriceMinor,
        imageUrl: input.imageUrl !== undefined ? input.imageUrl || null : undefined,
        sku: input.sku !== undefined ? input.sku.trim() || null : undefined,
        brand: input.brand !== undefined ? input.brand.trim() || null : undefined,
        unitLabel: input.unitLabel?.trim(),
        stockQuantity: input.stockQuantity,
        isFeatured: input.isFeatured,
        isVariableWeight: input.isVariableWeight,
        barcode: input.barcode !== undefined ? input.barcode.trim() || null : undefined,
        reorderLevel: input.reorderLevel
      }
    });
    return toItemView(updated);
  }

  /**
   * Deletes a product, but refuses once it appears on any order.
   *
   * Order lines snapshot their own name and price, but the row still references the product, and
   * removing it would break the link between an order and what was actually sold. Marking the item
   * unavailable is the right move for something no longer offered.
   */
  async deleteItem(restaurantId: string, itemId: string): Promise<{ message: string }> {
    const item = await this.requireOwnItem(restaurantId, itemId);
    const orderedCount = await this.prisma.orderItem.count({ where: { menuItemId: item.id } });
    if (orderedCount > 0) {
      throw new ApiException(
        409,
        "MENU_ITEM_IN_USE",
        "This product appears on past orders and cannot be deleted. Mark it unavailable instead.",
        { orderedCount }
      );
    }
    await this.prisma.menuItem.delete({ where: { id: item.id } });
    return { message: "The product was deleted." };
  }

  /** Refuses while the category still holds products, so nothing is deleted by surprise. */
  async deleteCategory(restaurantId: string, categoryId: string): Promise<{ message: string }> {
    const category = await this.requireOwnCategory(restaurantId, categoryId);
    const itemCount = await this.prisma.menuItem.count({ where: { categoryId: category.id } });
    if (itemCount > 0) {
      throw new ApiException(
        409,
        "MENU_CATEGORY_NOT_EMPTY",
        "Move or delete this category's products before deleting the category.",
        { itemCount }
      );
    }
    await this.prisma.menuCategory.delete({ where: { id: category.id } });
    return { message: "The category was deleted." };
  }

  async setItemAvailability(restaurantId: string, itemId: string, isAvailable: boolean): Promise<MenuItemOwnerView> {
    const item = await this.requireOwnItem(restaurantId, itemId);
    const updated = await this.prisma.menuItem.update({ where: { id: item.id }, data: { isAvailable } });
    return toItemView(updated);
  }

  private async requireOwnCategory(restaurantId: string, categoryId: string): Promise<MenuCategory> {
    const category = await this.prisma.menuCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.restaurantId !== restaurantId) {
      throw new ApiException(
        404,
        "MENU_CATEGORY_NOT_FOUND",
        "This menu category does not belong to your restaurant."
      );
    }
    return category;
  }

  private async requireOwnItem(restaurantId: string, itemId: string): Promise<MenuItem> {
    const item = await this.prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!item || item.restaurantId !== restaurantId) {
      throw new ApiException(404, "MENU_ITEM_NOT_FOUND", "This menu item does not belong to your restaurant.");
    }
    return item;
  }

  private async nextCategorySortOrder(restaurantId: string): Promise<number> {
    const categories = await this.prisma.menuCategory.findMany({ where: { restaurantId } });
    return categories.reduce((max, category) => Math.max(max, category.sortOrder), -1) + 1;
  }

  private async assertCategoryNameAvailable(
    restaurantId: string,
    name: string,
    excludedCategoryId?: string
  ): Promise<void> {
    const normalized = name.trim();
    if (!normalized) return;
    const existing = await this.prisma.menuCategory.findFirst({
      where: {
        restaurantId,
        name: { equals: normalized, mode: "insensitive" },
        id: excludedCategoryId ? { not: excludedCategoryId } : undefined
      }
    });
    if (existing) {
      throw new ApiException(
        409,
        "MENU_CATEGORY_NAME_EXISTS",
        "A category with this name already exists in this store."
      );
    }
  }

  private async assertCategorySortOrderAvailable(
    restaurantId: string,
    sortOrder: number,
    excludedCategoryId?: string
  ): Promise<void> {
    const existing = await this.prisma.menuCategory.findFirst({
      where: {
        restaurantId,
        sortOrder,
        id: excludedCategoryId ? { not: excludedCategoryId } : undefined
      }
    });
    if (existing) {
      throw new ApiException(
        409,
        "MENU_CATEGORY_SORT_ORDER_EXISTS",
        "Another category already uses this display order."
      );
    }
  }

  private async assertSkuAvailable(restaurantId: string, sku: string | undefined, excludedItemId?: string): Promise<void> {
    const normalized = sku?.trim();
    if (!normalized) return;
    const existing = await this.prisma.menuItem.findFirst({
      where: { restaurantId, sku: normalized, id: excludedItemId ? { not: excludedItemId } : undefined }
    });
    if (existing) {
      throw new ApiException(409, "MENU_ITEM_SKU_EXISTS", "This SKU is already used by another product in this store.");
    }
  }

  private async assertBarcodeAvailable(restaurantId: string, barcode: string | undefined, excludedItemId?: string): Promise<void> {
    const normalized = barcode?.trim();
    if (!normalized) return;
    const existing = await this.prisma.menuItem.findFirst({
      where: { restaurantId, barcode: normalized, id: excludedItemId ? { not: excludedItemId } : undefined }
    });
    if (existing) {
      throw new ApiException(409, "MENU_ITEM_BARCODE_EXISTS", "This barcode is already used by another product in this store.");
    }
  }
}

function toCategoryView(category: MenuCategory): MenuCategoryOwnerView {
  return { id: category.id, name: category.name, sortOrder: category.sortOrder, isActive: category.isActive };
}

function toItemView(item: MenuItem): MenuItemOwnerView {
  return {
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    priceMinor: item.priceMinor,
    costPriceMinor: item.costPriceMinor,
    imageUrl: item.imageUrl,
    sku: item.sku,
    brand: item.brand,
    unitLabel: item.unitLabel,
    stockQuantity: item.stockQuantity,
    isFeatured: item.isFeatured,
    isVariableWeight: item.isVariableWeight,
    barcode: item.barcode,
    reorderLevel: item.reorderLevel,
    isAvailable: item.isAvailable
  };
}
