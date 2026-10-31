import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsNumber, IsOptional, Max, Min } from "class-validator";

export class ReverseGeocodeQueryDto {
  @ApiProperty({ example: 31.9038 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 35.2034 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon!: number;

  @ApiPropertyOptional({ enum: ["ar", "en"], example: "ar" })
  @IsOptional()
  @IsIn(["ar", "en"])
  lang?: "ar" | "en";
}
