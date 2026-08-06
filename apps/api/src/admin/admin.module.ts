import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminAuditLogController } from "./admin-audit-log.controller";
import { AdminDashboardController } from "./admin-dashboard.controller";
import { AdminUsersController } from "./admin-users.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminDashboardController, AdminUsersController, AdminAuditLogController],
  providers: [AdminService, JwtAuthGuard, RolesGuard]
})
export class AdminModule {}
