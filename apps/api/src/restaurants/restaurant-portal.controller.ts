import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { MenuService } from "./menu.service";
import {
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  SetItemAvailabilityDto,
  SetOpenStatusDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto,
  UpdateRestaurantProfileDto
} from "./restaurants.dto";
import { RestaurantsService } from "./restaurants.service";

@ApiTags("restaurant-portal")
@ApiBearerAuth()
@Controller("restaurant")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RESTAURANT)
export class RestaurantPortalController {
  constructor(
    private readonly restaurants: RestaurantsService,
    private readonly menu: MenuService
  ) {}

  @Get("me")
  @ApiOperation({ summary: "Get the authenticated owner's restaurant profile" })
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.restaurants.getOwnProfile(request.user.id);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update the authenticated owner's restaurant profile" })
  updateProfile(@Req() request: AuthenticatedRequest, @Body() input: UpdateRestaurantProfileDto) {
    return this.restaurants.updateOwnProfile(request.user.id, input);
  }

  @Patch("me/open-status")
  @ApiOperation({ summary: "Toggle whether the restaurant is currently accepting orders" })
  setOpenStatus(@Req() request: AuthenticatedRequest, @Body() input: SetOpenStatusDto) {
    return this.restaurants.setOwnOpenStatus(request.user.id, input.isOpen);
  }

  @Get("me/menu/categories")
  @ApiOperation({ summary: "List the authenticated owner's menu categories" })
  async listCategories(@Req() request: AuthenticatedRequest) {
    const restaurant = await this.restaurants.requireOwnRestaurant(request.user.id);
    return this.menu.listCategories(restaurant.id);
  }

  @Post("me/menu/categories")
  @ApiOperation({ summary: "Create a menu category" })
  async createCategory(@Req() request: AuthenticatedRequest, @Body() input: CreateMenuCategoryDto) {
    const restaurant = await this.restaurants.requireOwnRestaurant(request.user.id);
    return this.menu.createCategory(restaurant.id, input);
  }

  @Patch("me/menu/categories/:categoryId")
  @ApiOperation({ summary: "Update a menu category owned by the authenticated restaurant" })
  async updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param("categoryId", new ParseUUIDPipe()) categoryId: string,
    @Body() input: UpdateMenuCategoryDto
  ) {
    const restaurant = await this.restaurants.requireOwnRestaurant(request.user.id);
    return this.menu.updateCategory(restaurant.id, categoryId, input);
  }

  @Get("me/menu/items")
  @ApiOperation({ summary: "List the authenticated owner's menu items" })
  async listItems(@Req() request: AuthenticatedRequest) {
    const restaurant = await this.restaurants.requireOwnRestaurant(request.user.id);
    return this.menu.listItems(restaurant.id);
  }

  @Post("me/menu/items")
  @ApiOperation({ summary: "Create a menu item" })
  async createItem(@Req() request: AuthenticatedRequest, @Body() input: CreateMenuItemDto) {
    const restaurant = await this.restaurants.requireOwnRestaurant(request.user.id);
    return this.menu.createItem(restaurant.id, input);
  }

  @Patch("me/menu/items/:itemId")
  @ApiOperation({ summary: "Update a menu item owned by the authenticated restaurant" })
  async updateItem(
    @Req() request: AuthenticatedRequest,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() input: UpdateMenuItemDto
  ) {
    const restaurant = await this.restaurants.requireOwnRestaurant(request.user.id);
    return this.menu.updateItem(restaurant.id, itemId, input);
  }

  @Patch("me/menu/items/:itemId/availability")
  @ApiOperation({ summary: "Toggle a menu item's availability" })
  async setItemAvailability(
    @Req() request: AuthenticatedRequest,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() input: SetItemAvailabilityDto
  ) {
    const restaurant = await this.restaurants.requireOwnRestaurant(request.user.id);
    return this.menu.setItemAvailability(restaurant.id, itemId, input.isAvailable);
  }
}
