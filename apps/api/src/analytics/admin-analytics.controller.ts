import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { AnalyticsPeriodQueryDto, TopProductsQueryDto } from "./analytics.dto";
import { AnalyticsService } from "./analytics.service";

/**
 * Platform-wide sales analytics. Built from every business's orders, so it needs the same
 * cross-business order permission as the all-orders list — no new permission, and nothing a
 * holder of VIEW_ALL_ORDERS could not already read order by order.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/analytics")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("VIEW_ALL_ORDERS")
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("top-products")
  @ApiOperation({ summary: "Best-selling products from DELIVERED orders, ranked, with quantity and revenue in agorot" })
  topProducts(@Query() query: TopProductsQueryDto) {
    return this.analytics.topProducts(query);
  }

  @Get("peak-times")
  @ApiOperation({ summary: "DELIVERED orders by hour of day and weekday, in Asia/Hebron local time" })
  peakTimes(@Query() query: AnalyticsPeriodQueryDto) {
    return this.analytics.peakTimes(query);
  }

  @Get("customer-retention")
  @ApiOperation({ summary: "Returning (2+ DELIVERED orders) vs one-time customers, with the returning rate" })
  customerRetention(@Query() query: AnalyticsPeriodQueryDto) {
    return this.analytics.customerRetention(query);
  }
}
