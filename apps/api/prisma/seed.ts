import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { BusinessType, DriverApprovalStatus, PrismaClient, RestaurantStatus, UserRole } from "../src/generated/prisma/client";

dotenv.config({ path: "../../.env" });

// The upsert below resets the seeded admin's password to a known value on every run. Refuse to
// run against production so this can never reset a real admin's credentials to something public.
if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed in production");
}

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
      businessType: BusinessType.RESTAURANT,
      description: "Seeded demo restaurant for local development.",
      phone: "+970590000002",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      addressLine: "Al-Manara Square, Ramallah",
      latitude: 31.9038,
      longitude: 35.2034
    },
    update: {
      name: "Wasel Demo Kitchen",
      businessType: BusinessType.RESTAURANT,
      description: "Seeded demo restaurant for local development.",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      addressLine: "Al-Manara Square, Ramallah",
      latitude: 31.9038,
      longitude: 35.2034
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

  const supermarketOwner = await prisma.user.upsert({
    where: { phone: "+970590000004" },
    create: {
      fullName: "Demo Supermarket Owner",
      phone: "+970590000004",
      passwordHash,
      role: UserRole.RESTAURANT,
      phoneVerifiedAt: new Date(),
      isActive: true
    },
    update: {
      fullName: "Demo Supermarket Owner",
      passwordHash,
      role: UserRole.RESTAURANT,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });

  const supermarket = await prisma.restaurant.upsert({
    where: { ownerUserId: supermarketOwner.id },
    create: {
      ownerUserId: supermarketOwner.id,
      name: "JOVO MARKET",
      businessType: BusinessType.SUPERMARKET,
      description: "Everyday groceries, fresh produce and home essentials.",
      phone: "+970590000004",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      addressLine: "Rukab Street, Ramallah",
      latitude: 31.9019,
      longitude: 35.2042
    },
    update: {
      name: "JOVO MARKET",
      businessType: BusinessType.SUPERMARKET,
      description: "Everyday groceries, fresh produce and home essentials.",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      addressLine: "Rukab Street, Ramallah",
      latitude: 31.9019,
      longitude: 35.2042
    }
  });

  const supermarketDepartments = [
    { id: "00000000-0000-4000-8000-000000000101", name: "Fresh Produce", sortOrder: 0 },
    { id: "00000000-0000-4000-8000-000000000102", name: "Dairy & Eggs", sortOrder: 1 },
    { id: "00000000-0000-4000-8000-000000000103", name: "Pantry", sortOrder: 2 }
  ];

  for (const department of supermarketDepartments) {
    await prisma.menuCategory.upsert({
      where: { id: department.id },
      create: { ...department, restaurantId: supermarket.id, isActive: true },
      update: { name: department.name, sortOrder: department.sortOrder, isActive: true }
    });
  }

  const supermarketProducts = [
    {
      id: "00000000-0000-4000-8000-000000000111",
      categoryId: supermarketDepartments[0]!.id,
      name: "Bananas",
      description: "Fresh bananas selected daily.",
      priceMinor: 650,
      sku: "FRUIT-BANANA-KG",
      brand: null,
      unitLabel: "1 kg",
      stockQuantity: 60,
      isVariableWeight: true,
      barcode: "7291000000111",
      reorderLevel: 15,
      isFeatured: true
    },
    {
      id: "00000000-0000-4000-8000-000000000112",
      categoryId: supermarketDepartments[0]!.id,
      name: "Tomatoes",
      description: "Locally grown tomatoes.",
      priceMinor: 500,
      sku: "VEG-TOMATO-KG",
      brand: "Local Farm",
      unitLabel: "1 kg",
      stockQuantity: 45,
      isVariableWeight: true,
      barcode: "7291000000112",
      reorderLevel: 12,
      isFeatured: false
    },
    {
      id: "00000000-0000-4000-8000-000000000121",
      categoryId: supermarketDepartments[1]!.id,
      name: "Fresh Milk",
      description: "Full-fat pasteurized milk.",
      priceMinor: 750,
      sku: "DAIRY-MILK-1L",
      brand: "Palestine Dairy",
      unitLabel: "1 L bottle",
      stockQuantity: 30,
      isVariableWeight: false,
      barcode: "7291000000121",
      reorderLevel: 8,
      isFeatured: true
    },
    {
      id: "00000000-0000-4000-8000-000000000122",
      categoryId: supermarketDepartments[1]!.id,
      name: "Large Eggs",
      description: "A tray of fresh large eggs.",
      priceMinor: 1900,
      sku: "DAIRY-EGGS-30",
      brand: "Baladi Farms",
      unitLabel: "tray of 30",
      stockQuantity: 18,
      isVariableWeight: false,
      barcode: "7291000000122",
      reorderLevel: 6,
      isFeatured: false
    },
    {
      id: "00000000-0000-4000-8000-000000000131",
      categoryId: supermarketDepartments[2]!.id,
      name: "Basmati Rice",
      description: "Long-grain basmati rice.",
      priceMinor: 3200,
      sku: "PANTRY-RICE-5KG",
      brand: "Golden Field",
      unitLabel: "5 kg bag",
      stockQuantity: 24,
      isVariableWeight: false,
      barcode: "7291000000131",
      reorderLevel: 8,
      isFeatured: true
    }
  ];

  for (const product of supermarketProducts) {
    await prisma.menuItem.upsert({
      where: { id: product.id },
      create: {
        ...product,
        restaurantId: supermarket.id,
        isAvailable: true
      },
      update: {
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        priceMinor: product.priceMinor,
        sku: product.sku,
        brand: product.brand,
        unitLabel: product.unitLabel,
        stockQuantity: product.stockQuantity,
        isVariableWeight: product.isVariableWeight,
        barcode: product.barcode,
        reorderLevel: product.reorderLevel,
        isFeatured: product.isFeatured,
        isAvailable: true
      }
    });
  }

  const demoSupplier = await prisma.supplier.upsert({
    where: { id: "00000000-0000-4000-8000-000000000141" },
    create: {
      id: "00000000-0000-4000-8000-000000000141",
      restaurantId: supermarket.id,
      name: "Demo Grocery Distributor",
      phone: "+970599111222",
      note: "Demo supplier for Phase 13 inventory operations."
    },
    update: {
      name: "Demo Grocery Distributor",
      phone: "+970599111222",
      note: "Demo supplier for Phase 13 inventory operations.",
      isActive: true
    }
  });
  const demoPurchaseOrder = await prisma.purchaseOrder.upsert({
    where: { id: "00000000-0000-4000-8000-000000000151" },
    create: {
      id: "00000000-0000-4000-8000-000000000151",
      restaurantId: supermarket.id,
      supplierId: demoSupplier.id,
      createdByUserId: supermarketOwner.id,
      reference: "DEMO-PO-001",
      note: "Draft order ready to demonstrate stock receiving.",
      totalCostMinor: 14_400
    },
    update: {
      supplierId: demoSupplier.id,
      reference: "DEMO-PO-001",
      note: "Draft order ready to demonstrate stock receiving."
    }
  });
  await prisma.purchaseOrderItem.upsert({
    where: {
      purchaseOrderId_menuItemId: {
        purchaseOrderId: demoPurchaseOrder.id,
        menuItemId: supermarketProducts[2]!.id
      }
    },
    create: {
      purchaseOrderId: demoPurchaseOrder.id,
      menuItemId: supermarketProducts[2]!.id,
      quantity: 24,
      unitCostMinor: 600
    },
    update: {}
  });
  console.log("Seeded approved supermarket +970590000004: 3 departments, 5 products, supplier and draft purchase");

  await seedRolesAndMemberships();
}

/**
 * The roles migration seeds the system roles and backfills existing businesses, but a freshly
 * reset database is seeded *after* migrating, so the users and businesses created above still need
 * their role assignments. Keeping this here means `prisma migrate reset` produces a working
 * environment rather than an admin who cannot open their own dashboard.
 */
async function seedRolesAndMemberships(): Promise<void> {
  const [superAdminRole, businessAdminRole] = await Promise.all([
    prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } }),
    prisma.role.findUnique({ where: { key: "BUSINESS_ADMIN" } })
  ]);
  if (!superAdminRole || !businessAdminRole) {
    throw new Error("System roles are missing. Run `npm run prisma:deploy` before seeding.");
  }

  const promotedAdmins = await prisma.user.updateMany({
    where: { role: UserRole.ADMIN, platformRoleId: null },
    data: { platformRoleId: superAdminRole.id }
  });

  const businesses = await prisma.restaurant.findMany({ select: { id: true, ownerUserId: true } });
  for (const business of businesses) {
    await prisma.businessMember.upsert({
      where: { businessId_userId: { businessId: business.id, userId: business.ownerUserId } },
      create: {
        businessId: business.id,
        userId: business.ownerUserId,
        roleId: businessAdminRole.id,
        isActive: true
      },
      update: { isActive: true }
    });
  }
  console.log(
    `Seeded authorization: ${promotedAdmins.count} admin(s) given SUPER_ADMIN, ` +
      `${businesses.length} owner(s) given BUSINESS_ADMIN membership`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
