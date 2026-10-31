import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReverseGeocodeQueryDto } from "./geocoding.dto";
import { GeocodingService } from "./geocoding.service";

/**
 * Store audit M4. Signed-in users only (the address map is used at checkout and in the address
 * book), so the endpoint cannot be used as an anonymous open geocoding proxy. Also covered by the
 * global rate limiter. Coordinates are not stored or logged.
 */
@ApiTags("geocoding")
@ApiBearerAuth()
@Controller("geocode")
@UseGuards(JwtAuthGuard)
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get("reverse")
  @ApiOperation({ summary: "A readable address line for a map point, or null" })
  reverse(@Query() query: ReverseGeocodeQueryDto) {
    return this.geocoding.reverse(query.lat, query.lon, query.lang ?? "ar");
  }
}
