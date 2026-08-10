import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { AddBusinessStaffDto, UpdateBusinessStaffDto } from "./business-staff.dto";
import { BusinessStaffService } from "./business-staff.service";

@ApiTags("restaurant-portal")
@ApiBearerAuth()
@Controller("restaurant/me/staff")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.RESTAURANT)
@RequirePermission("MANAGE_BUSINESS_STAFF")
export class BusinessStaffController {
  constructor(private readonly staff: BusinessStaffService) {}

  @Get()
  @ApiOperation({ summary: "List everyone with access to the caller's business" })
  list(@Req() request: AuthenticatedRequest) {
    return this.staff.list(request.user.id);
  }

  @Post()
  @ApiOperation({ summary: "Create a staff account with access to the caller's business" })
  add(@Req() request: AuthenticatedRequest, @Body() input: AddBusinessStaffDto) {
    return this.staff.add(request.user.id, input);
  }

  @Patch(":staffUserId")
  @ApiOperation({ summary: "Change a staff member's business role or suspend their access" })
  update(
    @Req() request: AuthenticatedRequest,
    @Param("staffUserId", new ParseUUIDPipe()) staffUserId: string,
    @Body() input: UpdateBusinessStaffDto
  ) {
    return this.staff.update(request.user.id, staffUserId, input);
  }

  @Delete(":staffUserId")
  @ApiOperation({ summary: "Remove a staff member's access, keeping their history intact" })
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("staffUserId", new ParseUUIDPipe()) staffUserId: string
  ) {
    return this.staff.remove(request.user.id, staffUserId);
  }
}
