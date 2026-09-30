import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OTP_PROVIDER } from "./otp.provider";
import { createOtpProvider } from "./otp.provider.factory";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService],
      // The choice itself lives in otp.provider.factory.ts so it can be unit-tested; it throws
      // rather than falling back, so a misconfigured deployment fails to boot.
      useFactory: (config: ConfigService) => createOtpProvider(config)
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
