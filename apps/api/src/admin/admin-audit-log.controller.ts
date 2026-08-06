import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { AdminAuditLogQueryDto } from "./admin.dto";
import { AdminService } from "./admin.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/audit-log")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuditLogController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: "List audit log entries, filterable by actor, action, and date range" })
  list(@Query() query: AdminAuditLogQueryDto) {
    return this.admin.listAuditLog(query);
  }
}
