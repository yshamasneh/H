import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { AdminRestaurantsQueryDto } from "./restaurants.dto";
import { RestaurantsService } from "./restaurants.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/restaurants")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminRestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  @ApiOperation({ summary: "List restaurants, optionally filtered by status" })
  list(@Query() query: AdminRestaurantsQueryDto) {
    return this.restaurants.adminList(query);
  }

  @Post(":restaurantId/approve")
  @ApiOperation({ summary: "Approve a pending restaurant" })
  approve(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.approve(restaurantId);
  }

  @Post(":restaurantId/reject")
  @ApiOperation({ summary: "Reject a pending restaurant" })
  reject(@Param("restaurantId", new ParseUUIDPipe()) restaurantId: string) {
    return this.restaurants.reject(restaurantId);
  }
}
