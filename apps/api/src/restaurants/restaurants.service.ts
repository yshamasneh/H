import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hashPassword } from "../auth/crypto.util";
import { normalizePhoneNumber } from "../auth/phone.util";
import { writeAuditLog } from "../common/audit-log.util";
import { grantBusinessMembership } from "../common/authorization/business-membership.util";
import { resolveMemberBusinessId } from "../common/authorization/business-scope.util";
import { ApiException } from "../common/api.exception";
import {
  BusinessType,
  NotificationType,
  OrderStatus,
  Prisma,
  RestaurantStatus,
  UserRole,
  type Restaurant
} from "../generated/prisma/client";
import { createBusinessNotification } from "../notifications/notification.util";
import { PrismaService } from "../prisma/prisma.service";
import { DeferredEmitter } from "../realtime/deferred-emitter";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { isValidTimeOfDay, isWithinWeeklyHours, restaurantModerationTransitions } from "./restaurant.rules";
import type { AdminCreateBusinessDto, AdminRestaurantsQueryDto, RestaurantRegisterDto, SupermarketCatalogQueryDto, UpdateRestaurantProfileDto } from "./restaurants.dto";
import type { AdminMenuItemView, AdminRestaurantView, Page, RestaurantPeriodStats, RestaurantProfileView, RestaurantPublicView, RestaurantStatsView, SupermarketCatalogView, SupermarketProductView } from "./restaurants.types";

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @Optional() private readonly config?: ConfigService
  ) {}

  /** The restaurant vertical's own public launch gate; see orders.service.ts's copy of the same flag. */
  private isRestaurantOrderingEnabled(): boolean {
    return this.config?.get<boolean>("RESTAURANT_ORDERING_ENABLED") ?? false;
  }

  async register(input: RestaurantRegisterDto): Promise<{ message: string; restaurantId: string; status: RestaurantStatus }> {
    this.assertPasswordsMatch(input.password, input.confirmPassword);
    const phone = normalizePhoneNumber(input.countryCode, input.phoneNumber);
    const ownerFullName = input.ownerFullName.trim().replace(/\s+/g, " ");
    const restaurantName = input.restaurantName.trim();
    if (ownerFullName.length < 2) {
      throw new ApiException(400, "INVALID_FULL_NAME", "Please enter the owner's full name.");
    }

    const existingUser = await this.prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      throw phoneAlreadyRegistered();
    }

    const passwordHash = await hashPassword(input.password);

    try {
      const restaurant = await this.prisma.$transaction(async (transaction) => {
        const recheckedUser = await transaction.user.findUnique({ where: { phone } });
        if (recheckedUser) {
          throw phoneAlreadyRegistered();
        }
        const owner = await transaction.user.create({
          data: {
            fullName: ownerFullName,
            phone,
            passwordHash,
            role: UserRole.RESTAURANT,
            phoneVerifiedAt: new Date(),
            isActive: true
          }
        });
        const created = await transaction.restaurant.create({
          data: {
            ownerUserId: owner.id,
            name: restaurantName,
            businessType: (input.businessType as BusinessType | undefined) ?? BusinessType.RESTAURANT,
            description: input.description?.trim() || null,
            phone,
            addressLine: input.addressLine.trim(),
            status: RestaurantStatus.PENDING,
            isOpen: false
          }
        });
        // The owner needs a membership as well as the ownerUserId link, otherwise they hold no
        // permissions inside the business they just created.
        await grantBusinessMembership(transaction, { businessId: created.id, userId: owner.id });
        return created;
      });

      this.realtime.emitToAdmins("restaurant.pending.created", { restaurantId: restaurant.id, name: restaurant.name });

      return {
        message: `Your ${input.businessType === BusinessType.SUPERMARKET ? "supermarket" : "restaurant"} application was submitted and is awaiting admin approval. Log in with your phone number and password once it is approved.`,
        restaurantId: restaurant.id,
        status: restaurant.status
      };
    } catch (error) {
      if (isPrismaCode(error, "P2002")) {
        throw phoneAlreadyRegistered();
      }
      throw error;
    }
  }

  /**
   * Creates a business from the Super Admin dashboard, owner account included.
   *
   * Deliberately delegates to `register` rather than duplicating it: that path already creates the
   * owner, the business, and — since 15.1 — the BusinessMember row without which the owner would be
   * locked out of their own portal. A second implementation would be a second place for that bug to
   * come back. The only differences are that an administrator can approve it immediately and that
   * the action is attributed in the audit log.
   */
  async adminCreateBusiness(
    adminUserId: string,
    input: AdminCreateBusinessDto
  ): Promise<RestaurantProfileView> {
    const registration = await this.register({
      countryCode: input.countryCode,
      phoneNumber: input.phoneNumber,
      ownerFullName: input.ownerFullName,
      password: input.password,
      confirmPassword: input.password,
      restaurantName: input.businessName,
      addressLine: input.addressLine,
      description: input.description,
      businessType: input.businessType
    } as RestaurantRegisterDto);

    const created = await this.prisma.$transaction(async (tx) => {
      const business = input.approveImmediately
        ? await tx.restaurant.update({
            where: { id: registration.restaurantId },
            data: { status: RestaurantStatus.APPROVED }
          })
        : await tx.restaurant.findUniqueOrThrow({ where: { id: registration.restaurantId } });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "BUSINESS_CREATED_BY_ADMIN",
        entityType: "Restaurant",
        entityId: business.id,
        businessId: business.id,
        metadata: {
          businessType: business.businessType,
          approvedImmediately: input.approveImmediately === true
        }
      });
      return business;
    });

    return toProfileView(created);
  }

  /** Resolves the caller's business from their membership, so staff accounts work, not just owners. */
  async requireOwnRestaurant(memberUserId: string): Promise<Restaurant> {
    const businessId = await resolveMemberBusinessId(this.prisma, memberUserId);
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: businessId } });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "No restaurant is linked to this account.");
    }
    return restaurant;
  }

  async getOwnProfile(ownerUserId: string): Promise<RestaurantProfileView> {
    return toProfileView(await this.requireOwnRestaurant(ownerUserId));
  }

  /**
   * Owner-facing business snapshot: revenue (from delivered orders) and order volume for today
   * and the current calendar month. Boundaries are server-local so "today" matches the owner's day.
   */
  async getOwnStats(ownerUserId: string): Promise<RestaurantStatsView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [today, month, total] = await Promise.all([
      this.periodStats(restaurant.id, startOfToday),
      this.periodStats(restaurant.id, startOfMonth),
      this.periodStats(restaurant.id)
    ]);
    return { today, month, total };
  }

  private async periodStats(restaurantId: string, since?: Date): Promise<RestaurantPeriodStats> {
    const createdAt = since ? { gte: since } : undefined;
    // Sum in SQL rather than loading every delivered order into memory (M-8): same filter
    // (restaurant + DELIVERED + date window), just `_sum` instead of findMany().reduce().
    const [ordersCount, salesAggregate] = await Promise.all([
      this.prisma.order.count({ where: { restaurantId, createdAt } }),
      this.prisma.order.aggregate({
        where: { restaurantId, status: OrderStatus.DELIVERED, createdAt },
        _sum: { totalMinor: true }
      })
    ]);
    return {
      salesMinor: salesAggregate._sum.totalMinor ?? 0,
      ordersCount
    };
  }

  async updateOwnProfile(ownerUserId: string, input: UpdateRestaurantProfileDto): Promise<RestaurantProfileView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    if ((input.latitude === undefined) !== (input.longitude === undefined)) {
      throw new ApiException(
        400,
        "RESTAURANT_COORDINATES_INCOMPLETE",
        "Latitude and longitude must be updated together."
      );
    }
    const { opensAt, closesAt } = this.resolveWorkingHours(restaurant, input);
    const updated = await this.prisma.restaurant.update({
      where: { id: restaurant.id },
      data: {
        name: input.name?.trim(),
        description: input.description !== undefined ? input.description.trim() || null : undefined,
        addressLine: input.addressLine?.trim(),
        logoUrl: input.logoUrl !== undefined ? input.logoUrl || null : undefined,
        latitude: input.latitude,
        longitude: input.longitude,
        opensAt,
        closesAt
      }
    });
    return toProfileView(updated);
  }

  /**
   * Normalises the incoming opening hours to what should be written, validating the
   * pair as a whole. A blank string clears a bound; the two bounds must always be
   * both set or both cleared, and a set window must be two valid, different times.
   * Returns `undefined` for a bound the caller did not touch (Prisma leaves it alone).
   */
  private resolveWorkingHours(
    restaurant: Restaurant,
    input: UpdateRestaurantProfileDto
  ): { opensAt: string | null | undefined; closesAt: string | null | undefined } {
    const normalise = (value: string | undefined): string | null | undefined =>
      value === undefined ? undefined : value.trim() || null;
    const opensAt = normalise(input.opensAt);
    const closesAt = normalise(input.closesAt);
    if (opensAt === undefined && closesAt === undefined) return { opensAt, closesAt };

    const nextOpensAt = opensAt === undefined ? restaurant.opensAt : opensAt;
    const nextClosesAt = closesAt === undefined ? restaurant.closesAt : closesAt;
    if ((nextOpensAt === null) !== (nextClosesAt === null)) {
      throw new ApiException(
        400,
        "RESTAURANT_HOURS_INCOMPLETE",
        "Set both the opening and closing time, or clear both."
      );
    }
    if (nextOpensAt !== null && nextClosesAt !== null) {
      if (!isValidTimeOfDay(nextOpensAt) || !isValidTimeOfDay(nextClosesAt)) {
        throw new ApiException(400, "RESTAURANT_HOURS_INVALID", "Working hours must be valid times in HH:mm format.");
      }
      if (nextOpensAt === nextClosesAt) {
        throw new ApiException(400, "RESTAURANT_HOURS_INVALID", "The opening and closing time cannot be the same.");
      }
    }
    return { opensAt, closesAt };
  }

  async setOwnOpenStatus(ownerUserId: string, isOpen: boolean): Promise<RestaurantProfileView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    if (isOpen && restaurant.status !== RestaurantStatus.APPROVED) {
      throw new ApiException(409, "RESTAURANT_NOT_APPROVED", "The restaurant must be approved before it can open.");
    }
    if (isOpen && (restaurant.latitude === null || restaurant.longitude === null)) {
      throw new ApiException(
        409,
        "RESTAURANT_LOCATION_REQUIRED",
        "Set the restaurant location before opening for delivery orders."
      );
    }
    const updated = await this.prisma.restaurant.update({ where: { id: restaurant.id }, data: { isOpen } });
    return toProfileView(updated);
  }

  async listPublicRestaurants(page: number, pageSize: number): Promise<Page<RestaurantPublicView>> {
    if (!this.isRestaurantOrderingEnabled()) {
      return { items: [], page, pageSize, total: 0 };
    }
    const where = { businessType: BusinessType.RESTAURANT, status: RestaurantStatus.APPROVED, isOpen: true };
    const [restaurants, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.restaurant.count({ where })
    ]);
    return { items: restaurants.map(toPublicView), page, pageSize, total };
  }

  async getPublicRestaurant(restaurantId: string): Promise<RestaurantPublicView> {
    this.requireRestaurantOrderingEnabled();
    const restaurant = await this.requireApprovedRestaurant(restaurantId, BusinessType.RESTAURANT);
    return toPublicView(restaurant);
  }

  async getPublicMenu(restaurantId: string) {
    this.requireRestaurantOrderingEnabled();
    const restaurant = await this.requireApprovedRestaurant(restaurantId, BusinessType.RESTAURANT);
    const now = new Date();
    const [categories, offers] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { restaurantId, isActive: true },
        orderBy: { sortOrder: "asc" },
        include: { items: { where: { isAvailable: true }, orderBy: { name: "asc" } } }
      }),
      this.prisma.offer.findMany({
        where: {
          restaurantId,
          type: "PRODUCT_PERCENTAGE",
          isActive: true,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }]
        },
        orderBy: { discountPercent: "desc" }
      })
    ]);
    const offerByMenuItemId = new Map<string, (typeof offers)[number]>();
    for (const offer of offers) {
      if (offer.menuItemId && !offerByMenuItemId.has(offer.menuItemId)) {
        offerByMenuItemId.set(offer.menuItemId, offer);
      }
    }

    return {
      restaurant: toPublicView(restaurant),
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        items: category.items.map((item) => {
          return toPublicItemView(item, offerByMenuItemId.get(item.id));
        })
      }))
    };
  }

  async listPublicSupermarkets(page: number, pageSize: number, includeClosed = false): Promise<Page<RestaurantPublicView>> {
    const where = {
      businessType: BusinessType.SUPERMARKET,
      status: RestaurantStatus.APPROVED,
      ...(includeClosed ? {} : { isOpen: true })
    };
    const [supermarkets, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.restaurant.count({ where })
    ]);
    return { items: supermarkets.map(toPublicView), page, pageSize, total };
  }

  async getSupermarketCatalog(
    supermarketId: string,
    query: SupermarketCatalogQueryDto
  ): Promise<SupermarketCatalogView> {
    const supermarket = await this.requireApprovedRestaurant(supermarketId, BusinessType.SUPERMARKET);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const search = query.search?.trim();
    const departments = await this.prisma.menuCategory.findMany({
      where: { restaurantId: supermarketId, isActive: true },
      orderBy: { sortOrder: "asc" }
    });
    const departmentIds = departments.map((department) => department.id);
    if (query.categoryId && !departmentIds.includes(query.categoryId)) {
      throw new ApiException(404, "SUPERMARKET_DEPARTMENT_NOT_FOUND", "This supermarket department does not exist.");
    }

    const where: Prisma.MenuItemWhereInput = {
      restaurantId: supermarketId,
      isAvailable: true,
      // A supermarket product with no recorded cost price cannot be sold: calculateOrderQuote
      // fail-closes on it (ORDER_ITEM_COST_PRICE_MISSING) to avoid misallocating the margin.
      // Hide it from browse so it never appears orderable and then fails silently at cart-add.
      costPriceMinor: { not: null },
      categoryId: query.categoryId ?? { in: departmentIds },
      isFeatured: query.featured,
      AND: [
        { OR: [{ stockQuantity: null }, { stockQuantity: { gt: 0 } }] },
        ...(search
          ? [{
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { description: { contains: search, mode: "insensitive" as const } },
                { brand: { contains: search, mode: "insensitive" as const } },
                { sku: { contains: search, mode: "insensitive" as const } }
              ]
            }]
          : [])
      ]
    };
    const [products, total, allAvailable, offers] = await Promise.all([
      this.prisma.menuItem.findMany({
        where,
        orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.menuItem.count({ where }),
      this.prisma.menuItem.findMany({
        where: {
          restaurantId: supermarketId,
          isAvailable: true,
          costPriceMinor: { not: null },
          categoryId: { in: departmentIds },
          OR: [{ stockQuantity: null }, { stockQuantity: { gt: 0 } }]
        },
        select: { categoryId: true }
      }),
      this.activeProductOffers(supermarketId)
    ]);
    const offerByItem = bestOfferByMenuItem(offers);
    const departmentName = new Map(departments.map((department) => [department.id, department.name]));
    const countByDepartment = new Map<string, number>();
    for (const product of allAvailable) {
      countByDepartment.set(product.categoryId, (countByDepartment.get(product.categoryId) ?? 0) + 1);
    }
    return {
      supermarket: toPublicView(supermarket),
      departments: departments.map((department) => ({
        id: department.id,
        name: department.name,
        sortOrder: department.sortOrder,
        productCount: countByDepartment.get(department.id) ?? 0
      })),
      products: products.map((product) => ({
        ...toPublicItemView(product, offerByItem.get(product.id)),
        categoryId: product.categoryId,
        categoryName: departmentName.get(product.categoryId) ?? "Products"
      })),
      page,
      pageSize,
      total
    };
  }

  async getSupermarketProduct(supermarketId: string, productId: string): Promise<{
    supermarket: RestaurantPublicView;
    product: SupermarketProductView;
  }> {
    const supermarket = await this.requireApprovedRestaurant(supermarketId, BusinessType.SUPERMARKET);
    const product = await this.prisma.menuItem.findFirst({
      where: {
        id: productId,
        restaurantId: supermarketId,
        isAvailable: true,
        // Same fail-closed guard as the catalog: an item with no cost price is not orderable,
        // so a direct link to its detail page must 404 rather than offer an un-cartable product.
        costPriceMinor: { not: null },
        OR: [{ stockQuantity: null }, { stockQuantity: { gt: 0 } }],
        category: { isActive: true }
      },
      include: { category: true }
    });
    if (!product) {
      throw new ApiException(404, "SUPERMARKET_PRODUCT_NOT_FOUND", "This product is not available.");
    }
    const offer = bestOfferByMenuItem(await this.activeProductOffers(supermarketId)).get(product.id);
    return {
      supermarket: toPublicView(supermarket),
      product: {
        ...toPublicItemView(product, offer),
        categoryId: product.categoryId,
        categoryName: product.category.name
      }
    };
  }

  async adminList(query: AdminRestaurantsQueryDto): Promise<Page<RestaurantProfileView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.RestaurantWhereInput = {
      status: query.status ? (query.status as RestaurantStatus) : undefined,
      isOpen: query.isOpen,
      businessType: query.businessType ? (query.businessType as BusinessType) : undefined
    };
    const [restaurants, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.restaurant.count({ where })
    ]);
    return { items: restaurants.map(toProfileView), page, pageSize, total };
  }

  async adminGetRestaurant(restaurantId: string): Promise<AdminRestaurantView> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, include: { owner: true } });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant does not exist.");
    }
    const [totalOrdersCount, revenueAggregate] = await Promise.all([
      this.prisma.order.count({ where: { restaurantId } }),
      this.prisma.order.aggregate({
        where: { restaurantId, status: OrderStatus.DELIVERED },
        _sum: { totalMinor: true }
      })
    ]);
    const revenueMinor = revenueAggregate._sum.totalMinor ?? 0;
    return {
      ...toProfileView(restaurant),
      ownerFullName: restaurant.owner.fullName,
      ownerPhone: restaurant.owner.phone,
      totalOrdersCount,
      revenueMinor
    };
  }

  async adminGetRestaurantMenu(restaurantId: string): Promise<{ categories: { id: string; name: string; isActive: boolean; items: AdminMenuItemView[] }[] }> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant does not exist.");
    }
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { name: "asc" } } }
    });
    return {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        isActive: category.isActive,
        items: category.items.map((item) => ({
          id: item.id,
          categoryId: item.categoryId,
          categoryName: category.name,
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
        }))
      }))
    };
  }

  async adminListRestaurantOrders(restaurantId: string, page: number, pageSize: number) {
    const where = { restaurantId };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, status: true, totalMinor: true, createdAt: true, customerId: true }
      }),
      this.prisma.order.count({ where })
    ]);
    return { items: orders, page, pageSize, total };
  }

  async approve(adminUserId: string, restaurantId: string): Promise<RestaurantProfileView> {
    return this.transitionPendingStatus(adminUserId, restaurantId, RestaurantStatus.APPROVED, "RESTAURANT_APPROVED");
  }

  async reject(adminUserId: string, restaurantId: string): Promise<RestaurantProfileView> {
    return this.transitionPendingStatus(adminUserId, restaurantId, RestaurantStatus.REJECTED, "RESTAURANT_REJECTED");
  }

  async adminSuspend(adminUserId: string, restaurantId: string, reason: string): Promise<RestaurantProfileView> {
    return this.adminStatusChange(adminUserId, restaurantId, RestaurantStatus.SUSPENDED, restaurantModerationTransitions.suspend, "RESTAURANT_SUSPENDED", reason);
  }

  async adminReactivate(adminUserId: string, restaurantId: string): Promise<RestaurantProfileView> {
    return this.adminStatusChange(adminUserId, restaurantId, RestaurantStatus.APPROVED, restaurantModerationTransitions.reactivate, "RESTAURANT_REACTIVATED", undefined);
  }

  private async transitionPendingStatus(
    adminUserId: string,
    restaurantId: string,
    status: RestaurantStatus,
    auditAction: string
  ): Promise<RestaurantProfileView> {
    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant) {
        throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant does not exist.");
      }
      if (restaurant.status !== RestaurantStatus.PENDING) {
        throw new ApiException(
          409,
          "RESTAURANT_NOT_PENDING",
          "Only a restaurant awaiting approval can be approved or rejected."
        );
      }
      const next = await tx.restaurant.update({ where: { id: restaurantId }, data: { status } });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: auditAction,
        entityType: "Restaurant",
        entityId: restaurantId,
        metadata: { fromStatus: restaurant.status, toStatus: status }
      });
      await createBusinessNotification(tx, emitter, {
        businessId: restaurant.id,
        type: status === RestaurantStatus.APPROVED ? NotificationType.RESTAURANT_APPROVED : NotificationType.RESTAURANT_REJECTED,
        title: status === RestaurantStatus.APPROVED ? "Your restaurant was approved" : "Your restaurant application was rejected",
        body:
          status === RestaurantStatus.APPROVED
            ? "Congratulations! Your restaurant is now live and can start accepting orders."
            : "Your restaurant application was not approved. Please contact support for details.",
        relatedEntityId: restaurantId
      });
      return next;
    });
    emitter.flush();
    return toProfileView(updated);
  }

  private async adminStatusChange(
    adminUserId: string,
    restaurantId: string,
    targetStatus: RestaurantStatus,
    requiredCurrentStatus: RestaurantStatus,
    auditAction: string,
    reason: string | undefined
  ): Promise<RestaurantProfileView> {
    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant) {
        throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant does not exist.");
      }
      if (restaurant.status !== requiredCurrentStatus) {
        throw new ApiException(
          409,
          "RESTAURANT_INVALID_TRANSITION",
          `Restaurant cannot move from ${restaurant.status} to ${targetStatus}.`
        );
      }
      const data: Prisma.RestaurantUpdateInput = { status: targetStatus };
      if (targetStatus === RestaurantStatus.SUSPENDED) {
        data.isOpen = false;
      }
      const next = await tx.restaurant.update({ where: { id: restaurantId }, data });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: auditAction,
        entityType: "Restaurant",
        entityId: restaurantId,
        reason: reason ?? null,
        metadata: { fromStatus: restaurant.status, toStatus: targetStatus }
      });
      await createBusinessNotification(tx, emitter, {
        businessId: restaurant.id,
        type: targetStatus === RestaurantStatus.SUSPENDED ? NotificationType.RESTAURANT_SUSPENDED : NotificationType.RESTAURANT_APPROVED,
        title: targetStatus === RestaurantStatus.SUSPENDED ? "Your restaurant has been suspended" : "Your restaurant has been reactivated",
        body: reason ? `Reason: ${reason}` : "Your restaurant can accept orders again.",
        relatedEntityId: restaurantId
      });
      return next;
    });
    emitter.flush();
    return toProfileView(updated);
  }

  /** Structured, deliberate rejection for a single-resource restaurant lookup while the vertical
   *  is not launched — distinct from RESTAURANT_NOT_FOUND, so a client can tell "not open yet"
   *  apart from "this id doesn't exist". */
  private requireRestaurantOrderingEnabled(): void {
    if (!this.isRestaurantOrderingEnabled()) {
      throw new ApiException(404, "RESTAURANT_ORDERING_DISABLED", "Restaurant ordering is not available yet.");
    }
  }

  private async requireApprovedRestaurant(restaurantId: string, businessType?: BusinessType): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, status: RestaurantStatus.APPROVED, businessType }
    });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant is not available.");
    }
    return restaurant;
  }

  private activeProductOffers(restaurantId: string) {
    const now = new Date();
    return this.prisma.offer.findMany({
      where: {
        restaurantId,
        type: "PRODUCT_PERCENTAGE",
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }]
      },
      orderBy: { discountPercent: "desc" }
    });
  }

  private assertPasswordsMatch(password: string, confirmation: string): void {
    if (password !== confirmation) {
      throw new ApiException(400, "PASSWORDS_DO_NOT_MATCH", "The passwords do not match.");
    }
  }
}

function toPublicView(restaurant: Restaurant): RestaurantPublicView {
  return {
    id: restaurant.id,
    name: restaurant.name,
    businessType: restaurant.businessType,
    description: restaurant.description,
    phone: restaurant.phone,
    addressLine: restaurant.addressLine,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    logoUrl: restaurant.logoUrl,
    isOpen: restaurant.isOpen,
    opensAt: restaurant.opensAt,
    closesAt: restaurant.closesAt,
    isOpenNow: restaurant.isOpen && isWithinWeeklyHours(restaurant.opensAt, restaurant.closesAt, new Date())
  };
}

function bestOfferByMenuItem<T extends { menuItemId: string | null }>(offers: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const offer of offers) {
    if (offer.menuItemId && !result.has(offer.menuItemId)) result.set(offer.menuItemId, offer);
  }
  return result;
}

function toPublicItemView(
  item: {
    id: string;
    name: string;
    description: string | null;
    priceMinor: number;
    imageUrl: string | null;
    sku: string | null;
    brand: string | null;
    unitLabel: string;
    stockQuantity: number | null;
    isFeatured: boolean;
    isVariableWeight: boolean;
    barcode: string | null;
    reorderLevel: number | null;
  },
  offer?: {
    id: string;
    title: string;
    discountPercent: number | null;
    minimumSubtotalMinor: number;
    maxDiscountMinor: number | null;
  }
) {
  const discountMinor = offer && offer.minimumSubtotalMinor === 0
    ? Math.min(
        Math.floor(item.priceMinor * (offer.discountPercent ?? 0) / 100),
        offer.maxDiscountMinor ?? Number.MAX_SAFE_INTEGER
      )
    : 0;
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    priceMinor: item.priceMinor,
    effectivePriceMinor: item.priceMinor - discountMinor,
    imageUrl: item.imageUrl,
    sku: item.sku,
    brand: item.brand,
    unitLabel: item.unitLabel,
    stockQuantity: item.stockQuantity,
    isFeatured: item.isFeatured,
    isVariableWeight: item.isVariableWeight,
    barcode: item.barcode,
    reorderLevel: item.reorderLevel,
    offer: offer
      ? {
          id: offer.id,
          title: offer.title,
          discountPercent: offer.discountPercent!,
          minimumSubtotalMinor: offer.minimumSubtotalMinor
        }
      : null
  };
}

function toProfileView(restaurant: Restaurant): RestaurantProfileView {
  return { ...toPublicView(restaurant), status: restaurant.status, createdAt: restaurant.createdAt };
}

function phoneAlreadyRegistered(): ApiException {
  return new ApiException(
    409,
    "PHONE_ALREADY_REGISTERED",
    "An account already exists with this phone number. Please log in instead."
  );
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
