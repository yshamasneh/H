import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { UserRole } from "../generated/prisma/client";
import { AdminUsersQueryDto, AssignPlatformRoleDto, CreateAdminUserDto, SetUserActiveDto } from "./admin.dto";
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

  @Get(":userId/customer-detail")
  // Order history is order data, so this needs the cross-business order permission as well as
  // user management: holding MANAGE_USERS alone must not become a back door to every order.
  @RequirePermission("MANAGE_USERS", "VIEW_ALL_ORDERS")
  @ApiOperation({ summary: "A customer's delivered-order count, amount spent on delivered orders, and full order history" })
  customerDetail(@Param("userId", new ParseUUIDPipe()) userId: string) {
    return this.admin.getCustomerDetail(userId);
  }

  @Post("admins")
  @RequirePermission("MANAGE_ADMINS")
  @ApiOperation({ summary: "Create an administrator account with an initial password" })
  createAdmin(@Req() request: AuthenticatedRequest, @Body() input: CreateAdminUserDto) {
    return this.admin.createAdminUser(request.user.id, input);
  }

  @Patch(":userId/active")
  @ApiOperation({ summary: "Suspend or restore an account, ending its sessions immediately" })
  setActive(
    @Req() request: AuthenticatedRequest,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() input: SetUserActiveDto
  ) {
    return this.admin.setUserActive(request.user.id, userId, input);
  }

  @Patch(":userId/platform-role")
  @RequirePermission("MANAGE_ADMINS")
  @ApiOperation({ summary: "Assign or remove an administrator's platform role" })
  assignPlatformRole(
    @Req() request: AuthenticatedRequest,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() input: AssignPlatformRoleDto
  ) {
    return this.admin.assignPlatformRole(request.user.id, userId, input);
  }
}
