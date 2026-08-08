import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { CreateOfferDto, UpdateOfferDto } from "./offers.dto";
import { OffersService } from "./offers.service";

@ApiTags("admin-offers")
@ApiBearerAuth()
@Controller("admin/offers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @ApiOperation({ summary: "List every promotion, including scheduled and inactive offers" })
  list() {
    return this.offers.adminList();
  }

  @Post()
  @ApiOperation({ summary: "Create an admin-controlled product, order, or delivery offer" })
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateOfferDto) {
    return this.offers.adminCreate(request.user.id, input);
  }

  @Patch(":offerId")
  @ApiOperation({ summary: "Replace an offer configuration or activate/deactivate it" })
  update(
    @Req() request: AuthenticatedRequest,
    @Param("offerId", new ParseUUIDPipe()) offerId: string,
    @Body() input: UpdateOfferDto
  ) {
    return this.offers.adminUpdate(request.user.id, offerId, input);
  }
}
