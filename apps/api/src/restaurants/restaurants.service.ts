import { Injectable } from "@nestjs/common";
import { hashPassword } from "../auth/crypto.util";
import { normalizePhoneNumber } from "../auth/phone.util";
import { ApiException } from "../common/api.exception";
import { Prisma, RestaurantStatus, UserRole, type Restaurant } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AdminRestaurantsQueryDto, RestaurantRegisterDto, UpdateRestaurantProfileDto } from "./restaurants.dto";
import type { Page, RestaurantProfileView, RestaurantPublicView } from "./restaurants.types";

@Injectable()
export class RestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

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
        return transaction.restaurant.create({
          data: {
            ownerUserId: owner.id,
            name: restaurantName,
            description: input.description?.trim() || null,
            phone,
            addressLine: input.addressLine.trim(),
            status: RestaurantStatus.PENDING,
            isOpen: false
          }
        });
      });

      return {
        message: "Your restaurant application was submitted and is awaiting admin approval. Log in with your phone number and password once it is approved.",
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

  async requireOwnRestaurant(ownerUserId: string): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { ownerUserId } });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "No restaurant is linked to this account.");
    }
    return restaurant;
  }

  async getOwnProfile(ownerUserId: string): Promise<RestaurantProfileView> {
    return toProfileView(await this.requireOwnRestaurant(ownerUserId));
  }

  async updateOwnProfile(ownerUserId: string, input: UpdateRestaurantProfileDto): Promise<RestaurantProfileView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const updated = await this.prisma.restaurant.update({
      where: { id: restaurant.id },
      data: {
        name: input.name?.trim(),
        description: input.description !== undefined ? input.description.trim() || null : undefined,
        addressLine: input.addressLine?.trim(),
        logoUrl: input.logoUrl !== undefined ? input.logoUrl || null : undefined
      }
    });
    return toProfileView(updated);
  }

  async setOwnOpenStatus(ownerUserId: string, isOpen: boolean): Promise<RestaurantProfileView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const updated = await this.prisma.restaurant.update({ where: { id: restaurant.id }, data: { isOpen } });
    return toProfileView(updated);
  }

  async listPublicRestaurants(page: number, pageSize: number): Promise<Page<RestaurantPublicView>> {
    const where = { status: RestaurantStatus.APPROVED, isOpen: true };
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
    const restaurant = await this.requireApprovedRestaurant(restaurantId);
    return toPublicView(restaurant);
  }

  async getPublicMenu(restaurantId: string) {
    const restaurant = await this.requireApprovedRestaurant(restaurantId);
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { items: { where: { isAvailable: true }, orderBy: { name: "asc" } } }
    });

    return {
      restaurant: toPublicView(restaurant),
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        items: category.items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          priceMinor: item.priceMinor,
          imageUrl: item.imageUrl
        }))
      }))
    };
  }

  async adminList(query: AdminRestaurantsQueryDto): Promise<Page<RestaurantProfileView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.status ? { status: query.status as RestaurantStatus } : {};
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

  async approve(restaurantId: string): Promise<RestaurantProfileView> {
    return this.transitionPendingStatus(restaurantId, RestaurantStatus.APPROVED);
  }

  async reject(restaurantId: string): Promise<RestaurantProfileView> {
    return this.transitionPendingStatus(restaurantId, RestaurantStatus.REJECTED);
  }

  private async requireApprovedRestaurant(restaurantId: string): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, status: RestaurantStatus.APPROVED }
    });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant is not available.");
    }
    return restaurant;
  }

  private async transitionPendingStatus(restaurantId: string, status: RestaurantStatus): Promise<RestaurantProfileView> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
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
    const updated = await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { status } });
    return toProfileView(updated);
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
    description: restaurant.description,
    phone: restaurant.phone,
    addressLine: restaurant.addressLine,
    logoUrl: restaurant.logoUrl,
    isOpen: restaurant.isOpen
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
