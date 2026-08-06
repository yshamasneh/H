import { Body, Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { DriverRegisterDto } from "./drivers.dto";
import { DriversService } from "./drivers.service";

@ApiTags("drivers")
@Controller("drivers")
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Create a driver account" })
  register(@Body() input: DriverRegisterDto) {
    return this.drivers.register(input);
  }
}
