import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class NotificationsPaginationQueryDto {
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

export const broadcastAudiences = ["CUSTOMER", "DRIVER", "RESTAURANT"] as const;
export type BroadcastAudience = (typeof broadcastAudiences)[number];

export class BroadcastNotificationDto {
  @ApiProperty({ enum: broadcastAudiences, description: "Every active account with this role receives the message." })
  @IsIn(broadcastAudiences)
  audience!: BroadcastAudience;

  @ApiProperty({ example: "Weekend promotion" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: "Enjoy 20% off this weekend on all stores." })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  body!: string;
}
