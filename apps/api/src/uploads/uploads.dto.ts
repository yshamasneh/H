import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { allowedImageContentTypes, imagePurposes, type AllowedImageContentType, type ImagePurpose } from "./uploads.types";

export class CreateImageUploadUrlDto {
  @ApiProperty({ enum: imagePurposes })
  @IsIn(imagePurposes)
  purpose!: ImagePurpose;

  @ApiPropertyOptional({ description: "Required for product/logo images and for a business-scoped offer." })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiProperty({ enum: allowedImageContentTypes })
  @IsIn(allowedImageContentTypes)
  contentType!: AllowedImageContentType;

  @ApiProperty({ maximum: 5_242_880 })
  @IsInt()
  @Min(1)
  @Max(5_242_880)
  size!: number;
}
export class CompleteImageUploadDto {
  @ApiProperty()
  @IsString()
  @MaxLength(600)
  uploadId!: string;

  @ApiProperty({ enum: imagePurposes })
  @IsIn(imagePurposes)
  purpose!: ImagePurpose;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiProperty({ enum: allowedImageContentTypes })
  @IsIn(allowedImageContentTypes)
  contentType!: AllowedImageContentType;
}

export class DeleteUploadedImageDto {
  @ApiProperty({ enum: imagePurposes })
  @IsIn(imagePurposes)
  purpose!: ImagePurpose;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  imageUrl!: string;
}
