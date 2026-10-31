import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { GeocodingController } from "./geocoding.controller";
import { GeocodingService } from "./geocoding.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [GeocodingController],
  providers: [GeocodingService, JwtAuthGuard]
})
export class GeocodingModule {}
