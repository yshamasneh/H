import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";

export const supportedCountryCodes = ["+970", "+972"] as const;
export type SupportedCountryCode = (typeof supportedCountryCodes)[number];

export const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/;

export class PhoneDto {
  @ApiProperty({ enum: supportedCountryCodes, example: "+970" })
  @IsIn(supportedCountryCodes)
  countryCode!: SupportedCountryCode;

  @ApiProperty({ example: "0591234567" })
  @IsString()
  @MinLength(7)
  @MaxLength(30)
  phoneNumber!: string;
}

export class CustomerSignupRequestDto extends PhoneDto {
  @ApiProperty({ example: "Customer Name" })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ example: "Strong@123" })
  @IsString()
  @Matches(strongPasswordPattern, {
    message: "Password must be 8-72 characters and include uppercase, lowercase, number, and symbol."
  })
  password!: string;

  @ApiProperty({ example: "Strong@123" })
  @IsString()
  confirmPassword!: string;
}

export class VerifyOtpDto extends PhoneDto {
  @ApiProperty({ example: "483921" })
  @Matches(/^\d{6}$/, { message: "Verification code must contain exactly six digits." })
  code!: string;
}

export class LoginDto extends PhoneDto {
  @ApiProperty({ example: "Test@12345" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  resetToken!: string;

  @ApiProperty({ example: "NewStrong@123" })
  @IsString()
  @Matches(strongPasswordPattern, {
    message: "Password must be 8-72 characters and include uppercase, lowercase, number, and symbol."
  })
  password!: string;

  @ApiProperty({ example: "NewStrong@123" })
  @IsString()
  confirmPassword!: string;
}
