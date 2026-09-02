import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SettingsService } from "./settings.service";

/**
 * The customer app reads whether the "no substitution" checkout choice is
 * available. Any authenticated user may read this narrow view; only the admin
 * controller ({@link AdminSettingsController}) can change it.
 */
@ApiTags("settings")
@ApiBearerAuth()
@Controller("settings")
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: "Read the public platform settings" })
  get() {
    return this.settings.getPublic();
  }
}
