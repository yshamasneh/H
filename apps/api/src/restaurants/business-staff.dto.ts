import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Roles a business administrator may hand out inside their own business. */
export const assignableBusinessRoleKeys = ["BUSINESS_ADMIN", "BUSINESS_STAFF"] as const;

export class AddBusinessStaffDto {
  @ApiProperty({ example: "Layla Odeh" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: "+970" })
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  countryCode!: string;

  @ApiProperty({ example: "0591234567" })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phoneNumber!: string;

  @ApiProperty({ example: "Staff@12345" })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: "Staff@12345" })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  confirmPassword!: string;

  @ApiProperty({ enum: assignableBusinessRoleKeys, example: "BUSINESS_STAFF" })
  @IsIn(assignableBusinessRoleKeys)
  roleKey!: (typeof assignableBusinessRoleKeys)[number];
}

export class UpdateBusinessStaffDto {
  @ApiPropertyOptional({ enum: assignableBusinessRoleKeys })
  @IsOptional()
  @IsIn(assignableBusinessRoleKeys)
  roleKey?: (typeof assignableBusinessRoleKeys)[number];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
