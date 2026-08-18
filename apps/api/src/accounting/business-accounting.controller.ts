import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { resolveMemberBusinessId } from "../common/authorization/business-scope.util";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateOperatingCostDto } from "./accounting.dto";
import { AccountingService } from "./accounting.service";

/**
 * What the supermarket side can do with costs: report them, and watch what happened to them.
 *
 * There is deliberately no approval route here. A cost entered on this controller is PROPOSED and
 * stays that way until somebody holding `APPROVE_OPERATING_COSTS` on the platform side decides —
 * which is what "the supermarket partner reports and requests, it does not decide" means in code.
 */
@ApiTags("business-accounting")
@ApiBearerAuth()
@Controller("restaurant/me/operating-costs")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.RESTAURANT)
@RequirePermission("PROPOSE_OPERATING_COSTS")
export class BusinessAccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly prisma: PrismaService
  ) {}

  @Get()
  @ApiOperation({ summary: "Costs this business has reported, and where each one stands" })
  async list(@Req() request: AuthenticatedRequest) {
    const businessId = await resolveMemberBusinessId(this.prisma, request.user.id);
    return this.accounting.listOperatingCosts({ businessId });
  }

  @Post()
  @ApiOperation({
    summary: "Report a cost for approval. It is not split or charged to anyone until it is approved."
  })
  async propose(@Req() request: AuthenticatedRequest, @Body() input: CreateOperatingCostDto) {
    const businessId = await resolveMemberBusinessId(this.prisma, request.user.id);
    return this.accounting.proposeOperatingCost(request.user.id, businessId, input);
  }
}
