import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import {
  CreateRateSetDto,
  DecideOperatingCostDto,
  GenerateSubscriptionChargesDto,
  RecordAdjustmentDto,
  RecordCashSettlementDto,
  RecordPartnerSettlementDto
} from "./accounting.dto";
import { AccountingService } from "./accounting.service";

/**
 * The platform's accounting surface.
 *
 * Reading the books and moving money are separate authorities: `VIEW_ACCOUNTING` sees everything,
 * while taking a driver's cash, approving a spend, paying a partner, and changing a rate each need
 * their own permission — so the person who counts the cash need not be the person who sets the
 * commission.
 */
@ApiTags("accounting")
@ApiBearerAuth()
@Controller("admin/accounting")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("VIEW_ACCOUNTING")
export class AdminAccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get("overview")
  @ApiOperation({
    summary:
      "Platform totals: cash collected, cash still with drivers, what every party is owed, and whether the ledger balances"
  })
  getOverview() {
    return this.accounting.getOverview();
  }

  @Get("balances")
  @ApiOperation({ summary: "Every party's running total: earned, paid, and still outstanding" })
  listBalances() {
    return this.accounting.listPartnerBalances();
  }

  @Get("balances/pending")
  @ApiOperation({ summary: "Parties owed money right now — the payout queue" })
  listPending() {
    return this.accounting.listPendingPartnerSettlements();
  }

  @Get("cash/drivers")
  @ApiOperation({ summary: "Cash outstanding per driver, reported separately from what each driver has earned" })
  listDriverCash() {
    return this.accounting.listDriverCash();
  }

  @Get("cash/drivers/:driverUserId")
  @ApiOperation({ summary: "The individual orders behind one driver's cash balance" })
  listDriverCustody(
    @Param("driverUserId", new ParseUUIDPipe()) driverUserId: string,
    @Query("includeSettled") includeSettled?: string
  ) {
    return this.accounting.listDriverCustody(driverUserId, includeSettled !== "true");
  }

  @Post("cash/settlements")
  @RequirePermission("RECEIVE_DRIVER_CASH")
  @ApiOperation({
    summary:
      "Record a driver handing cash over. Partial handovers settle only as far as the money goes; a repeated reference is refused."
  })
  recordCashSettlement(@Req() request: AuthenticatedRequest, @Body() input: RecordCashSettlementDto) {
    return this.accounting.recordCashSettlement(request.user.id, input);
  }

  @Get("cash/settlements")
  @ApiOperation({ summary: "Handovers recorded, most recent first" })
  listCashSettlements(@Query("driverUserId") driverUserId?: string) {
    return this.accounting.listCashSettlements(driverUserId);
  }

  @Get("operating-costs")
  @ApiOperation({ summary: "Supermarket operating costs, including the approval queue" })
  listOperatingCosts(@Query("status") status?: string, @Query("businessId") businessId?: string) {
    return this.accounting.listOperatingCosts({ status, businessId });
  }

  @Post("operating-costs/:entryId/decision")
  @RequirePermission("APPROVE_OPERATING_COSTS")
  @ApiOperation({
    summary:
      "Approve or reject a proposed cost. Approval freezes the rate set onto the entry and writes the three-way split."
  })
  decideOperatingCost(
    @Req() request: AuthenticatedRequest,
    @Param("entryId", new ParseUUIDPipe()) entryId: string,
    @Body() input: DecideOperatingCostDto
  ) {
    return this.accounting.decideOperatingCost(request.user.id, entryId, input);
  }

  @Post("settlements")
  @RequirePermission("MANAGE_SETTLEMENTS")
  @ApiOperation({ summary: "Record that a partner, business, or driver was actually paid" })
  recordPartnerSettlement(@Req() request: AuthenticatedRequest, @Body() input: RecordPartnerSettlementDto) {
    return this.accounting.recordPartnerSettlement(request.user.id, input);
  }

  @Get("settlements")
  @ApiOperation({ summary: "Payouts recorded, most recent first" })
  listPartnerSettlements(@Query("payeeKey") payeeKey?: string) {
    return this.accounting.listPartnerSettlements(payeeKey);
  }

  @Post("subscriptions/generate")
  @RequirePermission("MANAGE_ACCOUNTING_SETTINGS")
  @ApiOperation({
    summary: "Raise one month's subscription for every billable restaurant. Safe to re-run: an already-billed month is skipped."
  })
  generateSubscriptions(@Req() request: AuthenticatedRequest, @Body() input: GenerateSubscriptionChargesDto) {
    return this.accounting.generateSubscriptionCharges(request.user.id, input);
  }

  @Post("adjustments")
  @RequirePermission("MANAGE_SETTLEMENTS")
  @ApiOperation({
    summary: "Correct the ledger with a new, attributed entry. Nothing already recorded is edited."
  })
  recordAdjustment(@Req() request: AuthenticatedRequest, @Body() input: RecordAdjustmentDto) {
    return this.accounting.recordAdjustment(request.user.id, input);
  }

  @Get("orders/:orderId")
  @ApiOperation({ summary: "One order's financial record, every entitlement it created, and the reconciliation" })
  getOrderRecord(@Param("orderId", new ParseUUIDPipe()) orderId: string) {
    return this.accounting.getOrderFinancialRecord(orderId);
  }

  @Get("rates")
  @ApiOperation({ summary: "Every rate set, newest first, with the one currently in force marked" })
  listRateSets() {
    return this.accounting.listRateSets();
  }

  @Post("rates")
  @RequirePermission("MANAGE_ACCOUNTING_SETTINGS")
  @ApiOperation({
    summary: "Change a rate by publishing a new version. Existing orders keep the version they were taken under."
  })
  createRateSet(@Req() request: AuthenticatedRequest, @Body() input: CreateRateSetDto) {
    return this.accounting.createRateSet(request.user.id, input);
  }
}
