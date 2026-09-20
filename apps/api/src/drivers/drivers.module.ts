import { Module } from "@nestjs/common";
import { RoutingModule } from "../routing/routing.module";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminDriversController } from "./admin-drivers.controller";
import { DriverPortalController } from "./driver-portal.controller";
import { DriversController } from "./drivers.controller";
import { DriversService } from "./drivers.service";

@Module({
  imports: [JwtModule.register({}), RoutingModule],
  controllers: [DriversController, DriverPortalController, AdminDriversController],
  providers: [DriversService, JwtAuthGuard, RolesGuard]
})
export class DriversModule {}
