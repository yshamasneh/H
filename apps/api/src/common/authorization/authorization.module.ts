import { Global, Module } from "@nestjs/common";
import { PermissionsGuard } from "../guards/permissions.guard";
import { AuthorizationService } from "./authorization.service";
import { SystemRolesService } from "./system-roles.service";

/**
 * Global so every feature module can apply `PermissionsGuard` without repeating providers, the
 * same way PrismaModule exposes PrismaService.
 */
@Global()
@Module({
  providers: [AuthorizationService, PermissionsGuard, SystemRolesService],
  exports: [AuthorizationService, PermissionsGuard]
})
export class AuthorizationModule {}
