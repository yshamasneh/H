import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";

export class ErrorTrackingTestError extends Error {
  override readonly name = "ErrorTrackingTestError";
}

/**
 * Proves error tracking end to end on a live deployment: an ordinary unhandled error, so it takes
 * exactly the path a real bug takes (AllExceptionsFilter → 500 → ErrorReporterService), and the
 * response's requestId is what to look for in the tracking service. Platform admins only.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/diagnostics")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_PLATFORM_SETTINGS")
export class ErrorTrackingTestController {
  @Post("test-error")
  @HttpCode(500)
  @ApiOperation({ summary: "Throw a deliberate unhandled error to verify error tracking receives it" })
  throwTestError(): never {
    throw new ErrorTrackingTestError(`Deliberate error-tracking test at ${new Date().toISOString()}`);
  }
}
