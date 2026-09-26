import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminNotificationsController } from "./admin-notifications.controller";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, JwtAuthGuard, RolesGuard]
})
export class NotificationsModule {}
