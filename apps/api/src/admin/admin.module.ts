import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
// Lives here, not in ObservabilityModule, because its guards need this module's JwtModule.
import { ErrorTrackingTestController } from "../observability/error-tracking-test.controller";
import { AdminAuditLogController } from "./admin-audit-log.controller";
import { AdminDashboardController } from "./admin-dashboard.controller";
import { AdminUsersController } from "./admin-users.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminDashboardController, AdminUsersController, AdminAuditLogController, ErrorTrackingTestController],
  providers: [AdminService, JwtAuthGuard, RolesGuard]
})
export class AdminModule {}
