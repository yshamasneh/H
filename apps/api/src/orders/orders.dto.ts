import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

export const orderPaymentMethodValues = ["CASH"] as const;
export type OrderPaymentMethodValue = (typeof orderPaymentMethodValues)[number];

export class CreateOrderItemDto {
  @ApiProperty()
  @IsUUID()
  menuItemId!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty()
  @IsUUID()
  restaurantId!: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items!: CreateOrderItemDto[];

  @ApiProperty({ example: "Home" })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  deliveryLabel!: string;

  @ApiProperty({ example: "Al-Manara Square, Ramallah" })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  deliveryAddressLine!: string;

  @ApiPropertyOptional({ example: 31.9038 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  deliveryLatitude?: number;

  @ApiPropertyOptional({ example: 35.2034 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  deliveryLongitude?: number;

  @ApiProperty({ enum: orderPaymentMethodValues, example: "CASH" })
  @IsIn(orderPaymentMethodValues)
  paymentMethod!: OrderPaymentMethodValue;
}

export const restaurantOrderStatusActionValues = ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "REJECTED"] as const;
export type RestaurantOrderStatusAction = (typeof restaurantOrderStatusActionValues)[number];

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: restaurantOrderStatusActionValues, example: "ACCEPTED" })
  @IsIn(restaurantOrderStatusActionValues)
  status!: RestaurantOrderStatusAction;

  @ApiPropertyOptional({ example: "Out of falafel today" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class OrdersPaginationQueryDto {
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

export const orderStatusValues = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DELIVERED",
  "REJECTED",
  "CANCELLED"
] as const;
export type OrderStatusValue = (typeof orderStatusValues)[number];

export class CancelOrderReasonDto {
  @ApiProperty({ example: "Restaurant is closed today, customer requested a refund" })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}

export class AdminOrdersFilterDto {
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

  @ApiPropertyOptional({ enum: orderStatusValues })
  @IsOptional()
  @IsIn(orderStatusValues)
  status?: OrderStatusValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: "2026-08-01T00:00:00.000Z" })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ example: "2026-08-31T23:59:59.999Z" })
  @IsOptional()
  @IsString()
  toDate?: string;
}
