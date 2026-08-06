import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { DevelopmentOtpProvider, OTP_PROVIDER, WebhookOtpProvider } from "./otp.provider";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>("OTP_PROVIDER", "development");
        if (provider === "webhook") {
          return new WebhookOtpProvider(
            config.getOrThrow<string>("OTP_WEBHOOK_URL"),
            config.getOrThrow<string>("OTP_WEBHOOK_TOKEN"),
            config.get<number>("OTP_WEBHOOK_TIMEOUT_MS", 5_000)
          );
        }
        if (provider === "development" && config.get<string>("NODE_ENV") !== "production") {
          return new DevelopmentOtpProvider();
        }
        throw new Error(`Unsupported OTP provider: ${provider}`);
      }
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
