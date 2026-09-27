import { Global, Module } from "@nestjs/common";
import { ErrorReporterService } from "./error-reporter.service";
import { ErrorTrackingTestController } from "./error-tracking-test.controller";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Global()
@Module({
  controllers: [MetricsController, ErrorTrackingTestController],
  providers: [ErrorReporterService, MetricsService],
  exports: [ErrorReporterService, MetricsService]
})
export class ObservabilityModule {}
