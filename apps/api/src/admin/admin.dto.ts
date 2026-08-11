import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

const userRoleValues = ["CUSTOMER", "RESTAURANT", "DRIVER", "ADMIN"] as const;

export class AdminUsersQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @ApiPropertyOptional({ enum: userRoleValues })
  @IsOptional()
  @IsIn(userRoleValues)
  role?: (typeof userRoleValues)[number];

  @ApiPropertyOptional({ description: "Matches against full name or phone number" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AdminAuditLogQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ example: "RESTAURANT_SUSPENDED" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: "2026-08-01T00:00:00.000Z" })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ example: "2026-08-31T23:59:59.999Z" })
  @IsOptional()
  @IsString()
  toDate?: string;
}

export const platformAssignableRoleKeys = ["SUPER_ADMIN"] as const;

export class CreateAdminUserDto {
  @ApiProperty({ example: "Nadia Haddad" })
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

  @ApiProperty({ example: "Admin@12345" })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({
    enum: platformAssignableRoleKeys,
    description: "Platform role. Omit to create an administrator with no permissions yet."
  })
  @IsOptional()
  @IsIn(platformAssignableRoleKeys)
  platformRoleKey?: (typeof platformAssignableRoleKeys)[number];
}

export class SetUserActiveDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  isActive!: boolean;

  @ApiProperty({ example: "Left the company" })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AssignPlatformRoleDto {
  @ApiPropertyOptional({ enum: platformAssignableRoleKeys, description: "Omit to remove the platform role." })
  @IsOptional()
  @IsIn(platformAssignableRoleKeys)
  platformRoleKey?: (typeof platformAssignableRoleKeys)[number];
}
