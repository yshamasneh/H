import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { PhoneDto, strongPasswordPattern } from "../auth/auth.dto";

export class AdminActionReasonDto {
  @ApiProperty({ example: "Repeated late deliveries" })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}

export class DriverRegisterDto extends PhoneDto {
  @ApiProperty({ example: "Driver Name" })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ example: "Strong@123" })
  @IsString()
  @Matches(strongPasswordPattern, {
    message: "Password must be 8-72 characters and include uppercase, lowercase, number, and symbol."
  })
  password!: string;

  @ApiProperty({ example: "Strong@123" })
  @IsString()
  confirmPassword!: string;
}

export class SetDriverOnlineStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isOnline!: boolean;
}

export const driverDeliveryStatusActionValues = ["PICKED_UP", "ON_THE_WAY", "DELIVERED"] as const;
export type DriverDeliveryStatusAction = (typeof driverDeliveryStatusActionValues)[number];

export class UpdateDeliveryStatusDto {
  @ApiProperty({ enum: driverDeliveryStatusActionValues, example: "PICKED_UP" })
  @IsIn(driverDeliveryStatusActionValues)
  status!: DriverDeliveryStatusAction;
}

export class DeliveriesPaginationQueryDto {
  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}
