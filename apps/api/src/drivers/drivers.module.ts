import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { DriverPortalController } from "./driver-portal.controller";
import { DriversController } from "./drivers.controller";
import { DriversService } from "./drivers.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [DriversController, DriverPortalController],
  providers: [DriversService, JwtAuthGuard, RolesGuard]
})
export class DriversModule {}
