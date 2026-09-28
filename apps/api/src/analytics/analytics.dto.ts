import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from "class-validator";

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/** A period in Asia/Hebron calendar days, both ends inclusive. Either end may be left open. */
export class AnalyticsPeriodQueryDto {
  @ApiPropertyOptional({ example: "2026-09-01", description: "First local (Asia/Hebron) day included, YYYY-MM-DD" })
  @IsOptional()
  @Matches(localDatePattern)
  fromDate?: string;

  @ApiPropertyOptional({ example: "2026-09-30", description: "Last local (Asia/Hebron) day included, YYYY-MM-DD" })
  @IsOptional()
  @Matches(localDatePattern)
  toDate?: string;

  @ApiPropertyOptional({ description: "Limit to one business" })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;
}

export const productSortValues = ["quantity", "revenue"] as const;
export type ProductSort = (typeof productSortValues)[number];

export class TopProductsQueryDto extends AnalyticsPeriodQueryDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: productSortValues, description: "Rank by quantity sold (default) or by revenue" })
  @IsOptional()
  @IsIn(productSortValues)
  sortBy?: ProductSort;
}
