import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNumber, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateLandmarkDto {
  @ApiProperty({ example: "City Center Roundabout" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

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
}

export class UpdateLandmarkDto extends CreateLandmarkDto {}
