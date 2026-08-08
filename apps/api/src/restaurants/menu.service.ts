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
    const category = await this.prisma.menuCategory.create({
      data: { restaurantId, name: input.name.trim(), sortOrder: input.sortOrder ?? 0 }
    });
    return toCategoryView(category);
  }

  async updateCategory(
    restaurantId: string,
    categoryId: string,
    input: UpdateMenuCategoryDto
  ): Promise<MenuCategoryOwnerView> {
    const category = await this.requireOwnCategory(restaurantId, categoryId);
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

  async updateItem(restaurantId: string, itemId: string, input: UpdateMenuItemDto): Promise<MenuItemOwnerView> {
    const item = await this.requireOwnItem(restaurantId, itemId);
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
