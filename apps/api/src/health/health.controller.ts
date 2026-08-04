import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("system")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Check API and PostgreSQL health" })
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      service: "tasawaq-api",
      database: "connected",
      time: new Date().toISOString()
    };
  }
}
