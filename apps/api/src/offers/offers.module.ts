import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminOffersController } from "./admin-offers.controller";
import { OffersService } from "./offers.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminOffersController],
  providers: [OffersService, JwtAuthGuard, RolesGuard],
  exports: [OffersService]
})
export class OffersModule {}
