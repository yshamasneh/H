import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { DevelopmentOtpProvider, OTP_PROVIDER } from "./otp.provider";

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
        if (provider !== "development") {
          throw new Error(`Unsupported OTP provider: ${provider}`);
        }
        if (config.get<string>("NODE_ENV") === "production") {
          throw new Error("The development OTP provider cannot run in production.");
        }
        return new DevelopmentOtpProvider();
      }
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
