import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MenuService } from "../restaurants/menu.service";
import { RestaurantsService } from "../restaurants/restaurants.service";
import { salePercentOff } from "../restaurants/sale-price";

/**
 * The product offer, end to end: a manager (or an administrator — both controllers call the same
 * MenuService.updateItem) types an offer price, it is stored as the product's `salePriceMinor`, and
 * the customer's catalogue and product page carry it — the struck regular price, the charged price,
 * and so the sticker's percentage. Ending the offer puts the regular price back everywhere.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
const phone = "+970594900177";

test(
  "an offer price set by the store reaches the customer, and ending it restores the regular price",
  { skip: !runDatabaseE2e, timeout: 60_000 },
  async (context) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const prisma = app.get(PrismaService);
    const menu = app.get(MenuService);
    const restaurants = app.get(RestaurantsService);

    const databaseUrl = app.get(ConfigService).getOrThrow<string>("DATABASE_URL");
    if (!new URL(databaseUrl).pathname.toLowerCase().includes("test")) {
      await app.close();
      throw new Error("This E2E requires a database whose name contains 'test'.");
    }

    const cleanup = async () => {
      const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
      if (!owner) return;
      const store = await prisma.restaurant.findUnique({ where: { ownerUserId: owner.id }, select: { id: true } });
      if (store) {
        await prisma.menuItem.deleteMany({ where: { restaurantId: store.id } });
        await prisma.menuCategory.deleteMany({ where: { restaurantId: store.id } });
        await prisma.restaurant.delete({ where: { id: store.id } });
      }
      await prisma.user.delete({ where: { id: owner.id } });
    };
    context.after(async () => {
      try {
        await cleanup();
      } finally {
        await app.close();
      }
    });
    await cleanup();

    const owner = await prisma.user.create({
      data: {
        fullName: "Offers Owner",
        phone,
        passwordHash: await hashPassword("Offers@12345"),
        role: UserRole.RESTAURANT,
        phoneVerifiedAt: new Date(),
        isActive: true
      }
    });
    const store = await prisma.restaurant.create({
      data: {
        ownerUserId: owner.id,
        name: "Offers Market",
        businessType: BusinessType.SUPERMARKET,
        status: RestaurantStatus.APPROVED,
        isOpen: true,
        phone,
        addressLine: "Al-Manara Square, Ramallah",
        latitude: 31.9038,
        longitude: 35.2034
      }
    });
    const category = await prisma.menuCategory.create({
      data: { restaurantId: store.id, name: "Dairy", sortOrder: 0, isActive: true }
    });
    const seed = (name: string, priceMinor: number) =>
      prisma.menuItem.create({
        data: { restaurantId: store.id, categoryId: category.id, name, priceMinor, costPriceMinor: 500, unitLabel: "item", isAvailable: true }
      });
    const milk = await seed("Offer milk", 2000);
    const cheese = await seed("Offer cheese", 10_000);

    const customerView = async (id: string) => (await restaurants.getSupermarketProduct(store.id, id)).product;
    const catalogueView = async (id: string) =>
      (await restaurants.getSupermarketCatalog(store.id, {} as never)).products.find((product) => product.id === id);

    // Before any offer: one price, no sale.
    assert.equal((await customerView(milk.id)).salePriceMinor, null);
    assert.equal((await customerView(milk.id)).effectivePriceMinor, 2000);

    // Staff without MANAGE_PRICES cannot start an offer.
    await assert.rejects(
      menu.updateItem(store.id, milk.id, { salePriceMinor: 1000 } as never, { canManagePrices: false }),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 403
    );

    // 20 → 10: the customer sees both prices, and the sticker's 50% follows from them.
    const saved = await menu.updateItem(store.id, milk.id, { salePriceMinor: 1000 } as never, { canManagePrices: true });
    assert.equal(saved.salePriceMinor, 1000);
    const onOffer = await customerView(milk.id);
    assert.equal(onOffer.priceMinor, 2000);
    assert.equal(onOffer.salePriceMinor, 1000);
    assert.equal(onOffer.effectivePriceMinor, 1000);
    assert.equal(salePercentOff(onOffer.priceMinor, onOffer.salePriceMinor!), 50);
    const listed = await catalogueView(milk.id);
    assert.equal(listed?.salePriceMinor, 1000);
    assert.equal(listed?.effectivePriceMinor, 1000);

    // Editing the offer price changes what the customer sees: 20 → 15 is 25%.
    await menu.updateItem(store.id, milk.id, { salePriceMinor: 1500 } as never, { canManagePrices: true });
    const edited = await customerView(milk.id);
    assert.equal(edited.salePriceMinor, 1500);
    assert.equal(salePercentOff(edited.priceMinor, edited.salePriceMinor!), 25);

    // 100 → 70 is 30%.
    await menu.updateItem(store.id, cheese.id, { salePriceMinor: 7000 } as never, { canManagePrices: true });
    const cheeseView = await customerView(cheese.id);
    assert.equal(salePercentOff(cheeseView.priceMinor, cheeseView.salePriceMinor!), 30);

    // An offer equal to or above the regular price, or zero, is refused and changes nothing.
    for (const salePriceMinor of [1500 + 500, 2500, 0]) {
      await assert.rejects(menu.updateItem(store.id, milk.id, { salePriceMinor } as never, { canManagePrices: true }));
    }
    assert.equal((await customerView(milk.id)).salePriceMinor, 1500);

    // Ending the offer: back to the regular price, no sale for the customer.
    await menu.updateItem(store.id, milk.id, { salePriceMinor: null } as never, { canManagePrices: true });
    const ended = await customerView(milk.id);
    assert.equal(ended.salePriceMinor, null);
    assert.equal(ended.effectivePriceMinor, 2000);
    assert.equal((await catalogueView(milk.id))?.salePriceMinor, null);
  }
);
