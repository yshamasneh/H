import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LandmarksService } from "./landmarks.service";

/**
 * Landmarks are purely visual orientation points on the customer address map, so
 * they are readable by any authenticated app user. Only the admin controller
 * ({@link AdminLandmarksController}) can write them.
 */
@ApiTags("landmarks")
@ApiBearerAuth()
@Controller("landmarks")
@UseGuards(JwtAuthGuard)
export class LandmarksController {
  constructor(private readonly landmarks: LandmarksService) {}

  @Get()
  @ApiOperation({ summary: "List public orientation landmarks for the address map" })
  list() {
    return this.landmarks.list();
  }
}
