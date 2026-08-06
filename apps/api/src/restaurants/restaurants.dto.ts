import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";
import { PhoneDto, strongPasswordPattern } from "../auth/auth.dto";

export const restaurantStatusValues = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export type RestaurantStatusValue = (typeof restaurantStatusValues)[number];

export class RestaurantRegisterDto extends PhoneDto {
  @ApiProperty({ example: "Restaurant Owner" })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerFullName!: string;

  @ApiProperty({ example: "Strong@123" })
  @IsString()
  @Matches(strongPasswordPattern, {
    message: "Password must be 8-72 characters and include uppercase, lowercase, number, and symbol."
  })
  password!: string;

  @ApiProperty({ example: "Strong@123" })
  @IsString()
  confirmPassword!: string;

  @ApiProperty({ example: "Falafel House" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  restaurantName!: string;

  @ApiProperty({ example: "Al-Manara Square, Ramallah" })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  addressLine!: string;

  @ApiPropertyOptional({ example: "Family-owned falafel and hummus restaurant." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateRestaurantProfileDto {
  @ApiPropertyOptional({ example: "Falafel House" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: "Family-owned falafel and hummus restaurant." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: "Al-Manara Square, Ramallah" })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional({ example: "https://example.com/logo.png" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string;
}

export class SetOpenStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isOpen!: boolean;
}

export class CreateMenuCategoryDto {
  @ApiProperty({ example: "Sandwiches" })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateMenuCategoryDto {
  @ApiPropertyOptional({ example: "Sandwiches" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateMenuItemDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: "Falafel Sandwich" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: "Crispy falafel with tahini and pickles." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 1500, description: "Price in minor currency units, e.g. 1500 = 15.00 ILS." })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceMinor!: number;

  @ApiPropertyOptional({ example: "https://example.com/falafel.jpg" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;
}

export class UpdateMenuItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: "Falafel Sandwich" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: "Crispy falafel with tahini and pickles." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceMinor?: number;

  @ApiPropertyOptional({ example: "https://example.com/falafel.jpg" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;
}

export class SetItemAvailabilityDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isAvailable!: boolean;
}

export class PaginationQueryDto {
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
}

export class AdminRestaurantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: restaurantStatusValues })
  @IsOptional()
  @IsIn(restaurantStatusValues)
  status?: RestaurantStatusValue;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isOpen?: boolean;
}

export class AdminActionReasonDto {
  @ApiProperty({ example: "Multiple hygiene complaints" })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}
