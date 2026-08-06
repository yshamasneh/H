import { Global, Module } from "@nestjs/common";
import { ErrorReporterService } from "./error-reporter.service";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [ErrorReporterService, MetricsService],
  exports: [ErrorReporterService, MetricsService]
})
export class ObservabilityModule {}
