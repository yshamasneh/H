import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

export class UpdateMyProfileDto {
  @ApiPropertyOptional({ example: "Mohammad Ahmad" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ example: "customer@example.com", nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;
}

export class CreateAddressDto {
  @ApiProperty({ example: "Home" })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiProperty({ example: "Al-Manara Square, Ramallah" })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  addressLine!: string;

  @ApiProperty({ example: 31.9038 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 35.2034 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class RegisterPushTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(300)
  token!: string;

  @ApiProperty({ enum: ["android", "ios", "web"] })
  @IsIn(["android", "ios", "web"])
  platform!: "android" | "ios" | "web";
}

export class DeletePushTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(300)
  token!: string;
}

export class AddressIdDto {
  @IsUUID()
  addressId!: string;
}
