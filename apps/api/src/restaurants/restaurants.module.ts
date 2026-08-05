import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminRestaurantsController } from "./admin-restaurants.controller";
import { MenuService } from "./menu.service";
import { RestaurantPortalController } from "./restaurant-portal.controller";
import { RestaurantsController } from "./restaurants.controller";
import { RestaurantsService } from "./restaurants.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [RestaurantsController, RestaurantPortalController, AdminRestaurantsController],
  providers: [RestaurantsService, MenuService, JwtAuthGuard, RolesGuard]
})
export class RestaurantsModule {}
