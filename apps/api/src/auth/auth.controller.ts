import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  CustomerSignupRequestDto,
  LoginDto,
  PhoneDto,
  RefreshDto,
  ResetPasswordDto,
  VerifyOtpDto
} from "./auth.dto";
import { AuthService } from "./auth.service";
import { JwtAuthGuard, type AuthenticatedRequest } from "./jwt-auth.guard";

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("customer/signup/request-code")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Start or resend customer phone verification" })
  requestSignupCode(@Body() input: CustomerSignupRequestDto) {
    return this.auth.requestCustomerSignupCode(input);
  }

  @Post("customer/signup/verify-code")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Verify signup OTP and create a customer" })
  verifySignupCode(@Body() input: VerifyOtpDto) {
    return this.auth.verifyCustomerSignupCode(input);
  }

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Log in with phone number and password" })
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }

  @Post("refresh")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Rotate a refresh session" })
  refresh(@Body() input: RefreshDto) {
    return this.auth.refresh(input.refreshToken);
  }

  @Post("logout")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke the current session" })
  logout(@Req() request: AuthenticatedRequest) {
    return this.auth.logout(request.user);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the authenticated user" })
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.user);
  }

  @Post("password/forgot/request-code")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Start or resend password-reset verification" })
  requestPasswordResetCode(@Body() input: PhoneDto) {
    return this.auth.requestPasswordResetCode(input);
  }

  @Post("password/forgot/verify-code")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Verify reset OTP and issue a one-time reset token" })
  verifyPasswordResetCode(@Body() input: VerifyOtpDto) {
    return this.auth.verifyPasswordResetCode(input);
  }

  @Post("password/reset")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Set a new password using a one-time reset token" })
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.auth.resetPassword(input);
  }
}
