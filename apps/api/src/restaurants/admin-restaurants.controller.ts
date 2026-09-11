import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { UserRole } from "../generated/prisma/client";
import { MenuService } from "./menu.service";
import {
  AdminCreateBusinessDto,
  AdminRestaurantsQueryDto,
  AdminStoreLocationDto,
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  RestaurantAdminActionReasonDto,
  SetItemAvailabilityDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto
} from "./restaurants.dto";
import { RestaurantsService } from "./restaurants.service";
import { OrdersPaginationQueryDto } from "../orders/orders.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/restaurants")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_BUSINESSES")
export class AdminRestaurantsController {
  constructor(
    private readonly restaurants: RestaurantsService,
    private readonly menu: MenuService
  ) {}

  @Get()
  @ApiOperation({ summary: "List restaurants, optionally filtered by status and open/closed" })
  list(@Query() query: AdminRestaurantsQueryDto) {
    return this.restaurants.adminList(query);
  }

  @Post()
  @ApiOperation({ summary: "Create a restaurant or supermarket together with its owner account" })
  create(@Req() request: AuthenticatedRequest, @Body() input: AdminCreateBusinessDto) {
    return this.restaurants.adminCreateBusiness(request.user.id, input);
  }

  @Get(":restaurantId")
  @ApiOperation({ summary: "Get a restaurant's admin profile, including order-count and revenue stats" })
  getOne(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.adminGetRestaurant(restaurantId);
  }

  @Get(":restaurantId/menu")
  @ApiOperation({ summary: "Get a restaurant's full menu, including inactive categories and unavailable items" })
  getMenu(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.adminGetRestaurantMenu(restaurantId);
  }

  @Get(":restaurantId/orders")
  @ApiOperation({ summary: "List a restaurant's order history" })
  getOrders(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string, @Query() query: OrdersPaginationQueryDto) {
    return this.restaurants.adminListRestaurantOrders(restaurantId, query.page ?? 1, query.pageSize ?? 20);
  }

  @Post(":restaurantId/approve")
  @ApiOperation({ summary: "Approve a pending restaurant" })
  approve(@Req() request: AuthenticatedRequest, @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.approve(request.user.id, restaurantId);
  }

  @Post(":restaurantId/reject")
  @ApiOperation({ summary: "Reject a pending restaurant, recording the reason shown to the owner" })
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: RestaurantAdminActionReasonDto
  ) {
    return this.restaurants.reject(request.user.id, restaurantId, input.reason);
  }

  @Post(":restaurantId/suspend")
  @ApiOperation({ summary: "Suspend an approved restaurant (also closes it to new orders)" })
  suspend(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: RestaurantAdminActionReasonDto
  ) {
    return this.restaurants.adminSuspend(request.user.id, restaurantId, input.reason);
  }

  @Post(":restaurantId/reactivate")
  @ApiOperation({ summary: "Reactivate a suspended restaurant" })
  reactivate(@Req() request: AuthenticatedRequest, @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.adminReactivate(request.user.id, restaurantId);
  }

  @Patch(":restaurantId/location")
  @ApiOperation({ summary: "Set a store's location and whether customers may see it on its profile" })
  updateLocation(
    @Req() request: AuthenticatedRequest,
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: AdminStoreLocationDto
  ) {
    return this.restaurants.adminUpdateStoreLocation(request.user.id, restaurantId, input);
  }

  // ---- Product catalogue (admin CRUD over ANY store) --------------------------------------------
  // These mirror the store owner's own /restaurant/me/menu/* endpoints, but target a store by id
  // instead of the caller's own business. Access is the class-level ADMIN role + MANAGE_BUSINESSES
  // permission, so a store owner (or any non-admin) is rejected by the guards before reaching here —
  // the owner endpoints remain the only way a non-admin can touch a catalogue, and only their own.
  // The admin always has full price control, matching MANAGE_BUSINESSES being a superset.

  @Get(":restaurantId/menu/categories")
  @ApiOperation({ summary: "List a store's menu categories (including inactive)" })
  async listCategories(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.listCategories(restaurantId);
  }

  @Post(":restaurantId/menu/categories")
  @ApiOperation({ summary: "Create a menu category for any store" })
  async createCategory(
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: CreateMenuCategoryDto
  ) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.createCategory(restaurantId, input);
  }

  @Patch(":restaurantId/menu/categories/:categoryId")
  @ApiOperation({ summary: "Update a menu category for any store" })
  async updateCategory(
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("categoryId", new ParseUUIDPipe()) categoryId: string,
    @Body() input: UpdateMenuCategoryDto
  ) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.updateCategory(restaurantId, categoryId, input);
  }

  @Delete(":restaurantId/menu/categories/:categoryId")
  @ApiOperation({ summary: "Delete an empty menu category for any store" })
  async deleteCategory(
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("categoryId", new ParseUUIDPipe()) categoryId: string
  ) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.deleteCategory(restaurantId, categoryId);
  }

  @Get(":restaurantId/menu/items")
  @ApiOperation({ summary: "List a store's products (owner view, including cost price)" })
  async listItems(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.listItems(restaurantId);
  }

  @Post(":restaurantId/menu/items")
  @ApiOperation({ summary: "Create a product for any store" })
  async createItem(
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Body() input: CreateMenuItemDto
  ) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.createItem(restaurantId, input);
  }

  @Patch(":restaurantId/menu/items/:itemId")
  @ApiOperation({ summary: "Update a product for any store" })
  async updateItem(
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() input: UpdateMenuItemDto
  ) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.updateItem(restaurantId, itemId, input, { canManagePrices: true });
  }

  @Delete(":restaurantId/menu/items/:itemId")
  @ApiOperation({ summary: "Delete a product that has never been ordered, for any store" })
  async deleteItem(
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string
  ) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.deleteItem(restaurantId, itemId);
  }

  @Patch(":restaurantId/menu/items/:itemId/availability")
  @ApiOperation({ summary: "Toggle a product's availability for any store" })
  async setItemAvailability(
    @Param("restaurantId", new ParseUUIDPipe()) restaurantId: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() input: SetItemAvailabilityDto
  ) {
    await this.restaurants.assertStoreExists(restaurantId);
    return this.menu.setItemAvailability(restaurantId, itemId, input.isAvailable);
  }
}
