import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { DriverApprovalStatus, PrismaClient, RestaurantStatus, UserRole } from "../src/generated/prisma/client";

dotenv.config({ path: "../../.env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

async function main(): Promise<void> {
  const passwordHash = await argon2.hash("Test@12345", {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });

  await prisma.user.upsert({
    where: { phone: "+970590000000" },
    create: {
      fullName: "test",
      phone: "+970590000000",
      passwordHash,
      role: UserRole.CUSTOMER,
      phoneVerifiedAt: new Date(),
      isActive: true
    },
    update: {
      fullName: "test",
      passwordHash,
      role: UserRole.CUSTOMER,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  console.log("Seeded local customer: +970590000000");

  await prisma.user.upsert({
    where: { phone: "+970590000001" },
    create: {
      fullName: "admin",
      phone: "+970590000001",
      passwordHash,
      role: UserRole.ADMIN,
      phoneVerifiedAt: new Date(),
      isActive: true
    },
    update: {
      fullName: "admin",
      passwordHash,
      role: UserRole.ADMIN,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  console.log("Seeded local admin: +970590000001");

  const restaurantOwner = await prisma.user.upsert({
    where: { phone: "+970590000002" },
    create: {
      fullName: "Demo Restaurant Owner",
      phone: "+970590000002",
      passwordHash,
      role: UserRole.RESTAURANT,
      phoneVerifiedAt: new Date(),
      isActive: true
    },
    update: {
      fullName: "Demo Restaurant Owner",
      passwordHash,
      role: UserRole.RESTAURANT,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  console.log("Seeded local restaurant owner: +970590000002");

  const driver = await prisma.user.upsert({
    where: { phone: "+970590000003" },
    create: {
      fullName: "Demo Driver",
      phone: "+970590000003",
      passwordHash,
      role: UserRole.DRIVER,
      phoneVerifiedAt: new Date(),
      isActive: true
    },
    update: {
      fullName: "Demo Driver",
      passwordHash,
      role: UserRole.DRIVER,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });

  await prisma.driverProfile.upsert({
    where: { userId: driver.id },
    create: {
      userId: driver.id,
      status: DriverApprovalStatus.APPROVED,
      isOnline: false
    },
    update: {
      status: DriverApprovalStatus.APPROVED,
      isOnline: false
    }
  });
  console.log("Seeded approved local driver: +970590000003");

  const restaurant = await prisma.restaurant.upsert({
    where: { ownerUserId: restaurantOwner.id },
    create: {
      ownerUserId: restaurantOwner.id,
      name: "Wasel Demo Kitchen",
      description: "Seeded demo restaurant for local development.",
      phone: "+970590000002",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      addressLine: "Al-Manara Square, Ramallah"
    },
    update: {
      name: "Wasel Demo Kitchen",
      description: "Seeded demo restaurant for local development.",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      addressLine: "Al-Manara Square, Ramallah"
    }
  });
  console.log("Seeded demo restaurant: Wasel Demo Kitchen (APPROVED, open)");

  const mainsCategory = await prisma.menuCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      restaurantId: restaurant.id,
      name: "Mains",
      sortOrder: 0,
      isActive: true
    },
    update: { name: "Mains", isActive: true }
  });

  const drinksCategory = await prisma.menuCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000002" },
    create: {
      id: "00000000-0000-4000-8000-000000000002",
      restaurantId: restaurant.id,
      name: "Drinks",
      sortOrder: 1,
      isActive: true
    },
    update: { name: "Drinks", isActive: true }
  });

  const menuItems = [
    {
      id: "00000000-0000-4000-8000-000000000011",
      categoryId: mainsCategory.id,
      name: "Chicken Musakhan Wrap",
      description: "Sumac-roasted chicken, onions, and pine nuts in flatbread.",
      priceMinor: 2800
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      categoryId: mainsCategory.id,
      name: "Falafel Plate",
      description: "Six falafel pieces with hummus, salad, and pickles.",
      priceMinor: 2200
    },
    {
      id: "00000000-0000-4000-8000-000000000013",
      categoryId: mainsCategory.id,
      name: "Mixed Grill Plate",
      description: "Chicken and beef skewers with rice and grilled vegetables.",
      priceMinor: 4500
    },
    {
      id: "00000000-0000-4000-8000-000000000021",
      categoryId: drinksCategory.id,
      name: "Fresh Lemon Mint",
      description: null,
      priceMinor: 1200
    },
    {
      id: "00000000-0000-4000-8000-000000000022",
      categoryId: drinksCategory.id,
      name: "Bottled Water",
      description: null,
      priceMinor: 500
    }
  ];

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        restaurantId: restaurant.id,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        priceMinor: item.priceMinor,
        isAvailable: true
      },
      update: {
        name: item.name,
        description: item.description,
        priceMinor: item.priceMinor,
        isAvailable: true
      }
    });
  }
  console.log("Seeded demo menu: 2 categories, 5 items");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
