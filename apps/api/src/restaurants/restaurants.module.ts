import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { OffersModule } from "../offers/offers.module";
import { AdminRestaurantsController } from "./admin-restaurants.controller";
import { MenuService } from "./menu.service";
import { RestaurantPortalController } from "./restaurant-portal.controller";
import { RestaurantsController } from "./restaurants.controller";
import { SupermarketsController } from "./supermarkets.controller";
import { RestaurantsService } from "./restaurants.service";

@Module({
  imports: [JwtModule.register({}), OffersModule],
  controllers: [RestaurantsController, SupermarketsController, RestaurantPortalController, AdminRestaurantsController],
  providers: [RestaurantsService, MenuService, JwtAuthGuard, RolesGuard]
})
export class RestaurantsModule {}
