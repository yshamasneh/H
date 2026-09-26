import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UploadsModule } from "../uploads/uploads.module";
import { AdminOffersController } from "./admin-offers.controller";
import { OfferActivationNotifierService } from "./offer-activation.service";
import { OffersService } from "./offers.service";

@Module({
  imports: [JwtModule.register({}), UploadsModule],
  controllers: [AdminOffersController],
  providers: [OffersService, OfferActivationNotifierService, JwtAuthGuard, RolesGuard],
  exports: [OffersService]
})
export class OffersModule {}
