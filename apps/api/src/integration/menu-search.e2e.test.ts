import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RestaurantsService } from "../restaurants/restaurants.service";

/**
 * The trigram search's whole reason for existing: none of these three searches would find
 * anything under the old plain `contains(..., mode: "insensitive")` match.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
const phone = "+970594900099";

test(
  "supermarket product search tolerates typos, matches on one word of a multi-word name, and treats Arabic alef forms as equivalent (pg_trgm)",
  { skip: !runDatabaseE2e, timeout: 60_000 },
  async (context) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const prisma = app.get(PrismaService);
    const restaurants = app.get(RestaurantsService);

    const databaseUrl = app.get(ConfigService).getOrThrow<string>("DATABASE_URL");
    const parsed = new URL(databaseUrl);
    if (!parsed.pathname.toLowerCase().includes("test")) {
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

    const passwordHash = await hashPassword("Search@12345");
    const owner = await prisma.user.create({
      data: { fullName: "Search Owner", phone, passwordHash, role: UserRole.RESTAURANT, phoneVerifiedAt: new Date(), isActive: true }
    });
    const store = await prisma.restaurant.create({
      data: {
        ownerUserId: owner.id,
        name: "Search Market",
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
      data: { restaurantId: store.id, name: "Groceries", sortOrder: 0, isActive: true }
    });
    async function seed(name: string) {
      return prisma.menuItem.create({
        data: { restaurantId: store.id, categoryId: category.id, name, priceMinor: 500, costPriceMinor: 300, unitLabel: "item", isAvailable: true, stockQuantity: 10 }
      });
    }
    // Stored with a plain alef (ا), no hamza — see the "alef-variant equivalence" case below.
    const milk = await seed("حليب طازج"); // "fresh milk"
    const rice = await seed("ارز بسمتي"); // "basmati rice"
    const unrelated = await seed("عصير برتقال"); // "orange juice" — must never surface for the searches below

    async function searchTitles(searchTerm: string) {
      const result = await restaurants.getSupermarketCatalog(store.id, { search: searchTerm } as never);
      return result.products.map((product) => product.id);
    }

    // A one-letter substitution typo on "حليب" (milk) — a plain `contains` match would find nothing.
    const typoMatches = await searchTitles("حلبب");
    assert.ok(typoMatches.includes(milk.id), "a one-letter typo still finds the milk product");
    assert.ok(!typoMatches.includes(unrelated.id), "the unrelated product is not pulled in by the typo search");

    // Only the second of the two words in "حليب طازج" — word_similarity matches a query against
    // the best-fitting extent of the longer text, not just a leading/whole-string substring.
    const multiWordMatches = await searchTitles("طازج");
    assert.ok(multiWordMatches.includes(milk.id), "searching by only the second word of a two-word name still finds it");

    // Stored as "ارز" (bare alef); searching with the hamza'd alef form "أرز" must still find it.
    const alefMatches = await searchTitles("أرز بسمتي");
    assert.ok(alefMatches.includes(rice.id), "searching with a hamza'd alef finds a name stored with the bare alef");
    assert.ok(!alefMatches.includes(unrelated.id), "the unrelated product is not pulled in by the rice search");
  }
);
