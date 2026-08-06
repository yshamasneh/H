import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Headers, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { ApiException } from "../common/api.exception";
import { MetricsService } from "./metrics.service";

@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService
  ) {}

  @Get()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  render(@Headers("x-monitoring-token") providedToken: string | undefined, @Res({ passthrough: true }) response: Response): string {
    const expectedToken = this.config.get<string>("MONITORING_TOKEN", "");
    if (!expectedToken) throw new ApiException(404, "NOT_FOUND", "Resource not found.");
    if (!providedToken || !safeEqual(providedToken, expectedToken)) {
      throw new ApiException(401, "INVALID_MONITORING_TOKEN", "A valid monitoring token is required.");
    }
    response.type("text/plain; version=0.0.4; charset=utf-8");
    return this.metrics.renderPrometheus();
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
