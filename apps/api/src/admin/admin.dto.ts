import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

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
