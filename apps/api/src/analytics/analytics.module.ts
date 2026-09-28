import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminAnalyticsController } from "./admin-analytics.controller";
import { AnalyticsService } from "./analytics.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsService, JwtAuthGuard, RolesGuard]
})
export class AnalyticsModule {}
