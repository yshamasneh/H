import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminOrdersController } from "./admin-orders.controller";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { RestaurantOrdersController } from "./restaurant-orders.controller";

@Module({
  imports: [JwtModule.register({})],
  controllers: [OrdersController, RestaurantOrdersController, AdminOrdersController],
  providers: [OrdersService, JwtAuthGuard, RolesGuard]
})
export class OrdersModule {}
