import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { UserRole } from "../generated/prisma/client";
import { AdminUsersQueryDto } from "./admin.dto";
import { AdminService } from "./admin.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/users")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_USERS")
export class AdminUsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: "List every user across all roles, searchable by name or phone. Never returns password hashes." })
  list(@Query() query: AdminUsersQueryDto) {
    return this.admin.listUsers(query);
  }
}
