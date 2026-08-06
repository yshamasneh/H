import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PaginationQueryDto, RestaurantRegisterDto } from "./restaurants.dto";
import { RestaurantsService } from "./restaurants.service";

@ApiTags("restaurants")
@Controller("restaurants")
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Submit a restaurant application (creates a RESTAURANT owner account)" })
  register(@Body() input: RestaurantRegisterDto) {
    return this.restaurants.register(input);
  }

  @Get()
  @ApiOperation({ summary: "List approved and currently open restaurants" })
  list(@Query() query: PaginationQueryDto) {
    return this.restaurants.listPublicRestaurants(query.page ?? 1, query.pageSize ?? 20);
  }

  @Get("offers/active")
  @ApiOperation({ summary: "List active offers for approved, open restaurants" })
  listOffers() {
    return this.restaurants.listPublicOffers();
  }

  @Get(":restaurantId")
  @ApiOperation({ summary: "Get a single approved restaurant's public profile" })
  getOne(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.getPublicRestaurant(restaurantId);
  }

  @Get(":restaurantId/menu")
  @ApiOperation({ summary: "Get an approved restaurant's menu (active categories, available items)" })
  getMenu(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.getPublicMenu(restaurantId);
  }
}
