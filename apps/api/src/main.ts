import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { ApiException } from "./common/api.exception";
import { ConfiguredSocketIoAdapter } from "./config/socket-io.adapter";
import { ErrorReporterService } from "./observability/error-reporter.service";
import { MetricsService } from "./observability/metrics.service";
import { createRequestMiddleware } from "./observability/request.middleware";
import { StructuredLogger } from "./observability/structured-logger";

async function bootstrap() {
  const logger = new StructuredLogger();
  const app = await NestFactory.create(AppModule, { logger });
  const config = app.get(ConfigService);
  const isProduction = config.get<string>("NODE_ENV") === "production";
  const corsOrigin = config.get<string>("CORS_ORIGIN", "*");
  const allowedOrigins = corsOrigin === "*" ? true : corsOrigin.split(",").map((origin) => origin.trim());
  const express = app.getHttpAdapter().getInstance();

  express.disable("x-powered-by");
  express.set("trust proxy", config.get<number | false>("TRUST_PROXY", false));
  app.enableShutdownHooks();
  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app, allowedOrigins));
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false
    })
  );
  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
    credentials: false,
    maxAge: 600
  });
  app.setGlobalPrefix("api/v1");
  app.use(
    createRequestMiddleware(
      logger,
      app.get(MetricsService),
      config.get<boolean>("REQUIRE_HTTPS", isProduction)
    )
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      exceptionFactory: (errors) =>
        new ApiException(
          400,
          "VALIDATION_ERROR",
          "Please check the submitted information.",
          errors.map((error) => ({ field: error.property, messages: Object.values(error.constraints ?? {}) }))
        )
    })
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(ErrorReporterService)));

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("TasawaQ API")
      .setDescription("TasawaQ local development API")
      .setVersion(config.get<string>("APP_VERSION", "development"))
      .addBearerAuth()
      .build();
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  const port = config.get<number>("PORT", 3000);
  await app.listen(port, "0.0.0.0");
  logger.log({
    event: "application_started",
    port,
    environment: config.get<string>("NODE_ENV"),
    version: config.get<string>("APP_VERSION")
  });
}

void bootstrap();
