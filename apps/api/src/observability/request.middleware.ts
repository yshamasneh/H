import { randomUUID } from "node:crypto";
import type { LoggerService } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function createRequestMiddleware(
  logger: LoggerService,
  metrics: MetricsService,
  requireHttps: boolean
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const incomingRequestId = request.header("x-request-id");
    const requestId = incomingRequestId && requestIdPattern.test(incomingRequestId) ? incomingRequestId : randomUUID();
    request.headers["x-request-id"] = requestId;
    response.setHeader("x-request-id", requestId);
    response.setHeader("cache-control", "no-store");

    const path = request.originalUrl.split("?", 1)[0];
    const monitoringPath = path.startsWith("/api/v1/health/") || path === "/api/v1/metrics";
    metrics.requestStarted();
    const startedAt = process.hrtime.bigint();

    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      metrics.requestFinished(request.method, response.statusCode, durationMs);
      logger.log({
        event: "http_request_completed",
        requestId,
        method: request.method,
        path,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(3))
      });
    });

    if (requireHttps && !request.secure && !monitoringPath) {
      response.status(426).json({
        statusCode: 426,
        code: "HTTPS_REQUIRED",
        message: "HTTPS is required.",
        details: null,
        requestId
      });
      return;
    }
    next();
  };
}
