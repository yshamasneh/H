import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
export const businessTypeValues = ["RESTAURANT", "SUPERMARKET"] as const;
export type BusinessTypeValue = (typeof businessTypeValues)[number];

export class RestaurantRegisterDto extends PhoneDto {
  @ApiPropertyOptional({ enum: businessTypeValues, default: "RESTAURANT" })
  @IsOptional()
  @IsIn(businessTypeValues)
  businessType?: BusinessTypeValue;

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

  @ApiPropertyOptional({ example: 31.9038 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 35.2034 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ example: "09:00", description: "Weekly opening time (HH:mm, 24h). Empty string clears the schedule." })
  @IsOptional()
  @IsString()
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d)?$/, { message: "opensAt must be HH:mm (24h) or empty" })
  opensAt?: string;

  @ApiPropertyOptional({ example: "22:00", description: "Weekly closing time (HH:mm, 24h). Empty string clears the schedule." })
  @IsOptional()
  @IsString()
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d)?$/, { message: "closesAt must be HH:mm (24h) or empty" })
  closesAt?: string;
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

  @ApiPropertyOptional({
    example: 1000,
    description: "What the store paid for one unit, in minor currency units. Optional; kept for future margin/accounting reporting and never shown to customers."
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  costPriceMinor?: number;

  @ApiPropertyOptional({ example: "https://example.com/falafel.jpg" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ example: "MILK-1L-001" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @ApiPropertyOptional({ example: "Palestine Dairy" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiPropertyOptional({ example: "1 L bottle", default: "item" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  unitLabel?: string;

  @ApiPropertyOptional({ example: 40, description: "Null means inventory is not tracked." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  stockQuantity?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ example: false, description: "Allow the store to record the packed weight/quantity before acceptance." })
  @IsOptional()
  @IsBoolean()
  isVariableWeight?: boolean;

  @ApiPropertyOptional({ example: "6251001234567" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  barcode?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  reorderLevel?: number;
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

  @ApiPropertyOptional({ example: 1000, description: "Set to null to clear a previously recorded cost." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  costPriceMinor?: number | null;

  @ApiPropertyOptional({ example: "https://example.com/falafel.jpg" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  unitLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  stockQuantity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVariableWeight?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  reorderLevel?: number | null;
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

export class SupermarketListQueryDto extends PaginationQueryDto {
  /** When true, approved-but-closed supermarkets are included (used to resolve the single launch store). */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  includeClosed?: boolean;
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

  @ApiPropertyOptional({ enum: businessTypeValues })
  @IsOptional()
  @IsIn(businessTypeValues)
  businessType?: BusinessTypeValue;
}

export class SupermarketCatalogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: "milk" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  featured?: boolean;
}

export class RestaurantAdminActionReasonDto {
  @ApiProperty({ example: "Multiple hygiene complaints" })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}

export class AdminCreateBusinessDto extends PhoneDto {
  @ApiProperty({ example: "Wasel Kitchen" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName!: string;

  @ApiProperty({ example: "Sami Odeh" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerFullName!: string;

  @ApiProperty({ example: "Owner@12345" })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: "Al-Manara Square, Ramallah" })
  @IsString()
  @MinLength(4)
  @MaxLength(240)
  addressLine!: string;

  @ApiPropertyOptional({ enum: businessTypeValues, example: "RESTAURANT" })
  @IsOptional()
  @IsIn(businessTypeValues)
  businessType?: BusinessTypeValue;

  @ApiPropertyOptional({ example: "Charcoal grill and mezze." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** An administrator creating a business has already vetted it, so approval need not be a second step. */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  approveImmediately?: boolean;
}
