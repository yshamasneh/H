import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PartnerAccountsService } from "../accounting/partner-accounts.service";
import { ApiException } from "../common/api.exception";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("system")
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerAccounts: PartnerAccountsService
  ) {}

  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: "Check API and PostgreSQL health" })
  health() {
    return this.ready();
  }

  @Get("live")
  @SkipThrottle()
  @ApiOperation({ summary: "Check whether the API process is alive" })
  live() {
    return {
      ok: true,
      service: "tasawaq-api",
      status: "alive",
      time: new Date().toISOString()
    };
  }

  @Get("ready")
  @SkipThrottle()
  @ApiOperation({ summary: "Check whether the API and PostgreSQL are ready" })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiException(503, "SERVICE_NOT_READY", "The service is not ready to receive traffic.");
    }
    let partnerAccountStatus;
    try {
      partnerAccountStatus = await this.partnerAccounts.validate();
    } catch {
      throw new ApiException(503, "SERVICE_NOT_READY", "The service is not ready to receive traffic.");
    }
    if (!partnerAccountStatus.ready) {
      this.partnerAccounts.logInvalid(partnerAccountStatus.issues.map((issue) => issue.code));
      throw new ApiException(
        503,
        "FINANCIAL_REFERENCE_DATA_NOT_READY",
        "Required financial reference data is not ready."
      );
    }
    return {
      ok: true,
      service: "tasawaq-api",
      status: "ready",
      // Which commit this process was built from (set by the Docker build), so an operator or the
      // deploy workflow can confirm the live server runs the code that was just pushed.
      commit: process.env.GIT_SHA || null,
      database: "connected",
      time: new Date().toISOString()
    };
  }
}
