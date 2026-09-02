import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminSettingsController } from "./admin-settings.controller";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminSettingsController, SettingsController],
  providers: [SettingsService, JwtAuthGuard, RolesGuard],
  exports: [SettingsService]
})
export class SettingsModule {}
