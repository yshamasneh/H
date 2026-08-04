import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ApiException } from "./common/api.exception";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.enableCors({
    origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN?.split(",")
  });
  app.use((request: { headers: Record<string, string | string[] | undefined> }, response: unknown, next: () => void) => {
    if (!request.headers["x-request-id"]) {
      request.headers["x-request-id"] = randomUUID();
    }
    next();
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      exceptionFactory: (errors) =>
        new ApiException(400, "VALIDATION_ERROR", "Please check the submitted information.",
          errors.map((error) => ({ field: error.property, messages: Object.values(error.constraints ?? {}) })))
    })
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  if (process.env.NODE_ENV !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("TasawaQ API")
      .setDescription("TasawaQ local development API")
      .setVersion("0.2.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(`TasawaQ API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
