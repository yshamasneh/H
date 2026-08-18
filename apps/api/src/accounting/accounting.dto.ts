import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested
} from "class-validator";

export const operatingCostCategoryValues = [
  "WAREHOUSE_RENT",
  "STAFF_SALARY",
  "UTILITIES",
  "MAINTENANCE",
  "OTHER"
] as const;
export type OperatingCostCategoryValue = (typeof operatingCostCategoryValues)[number];

export const partnerSettlementMethodValues = ["CASH", "BANK_TRANSFER", "OFFSET"] as const;
export type PartnerSettlementMethodValue = (typeof partnerSettlementMethodValues)[number];

export const operatingCostStatusValues = ["PROPOSED", "APPROVED", "REJECTED"] as const;

export class CreateOperatingCostDto {
  @ApiProperty({ enum: operatingCostCategoryValues, example: "WAREHOUSE_RENT" })
  @IsIn(operatingCostCategoryValues)
  category!: OperatingCostCategoryValue;

  @ApiProperty({ example: "Warehouse rent for August" })
  @IsString()
  @Length(3, 300)
  description!: string;

  @ApiProperty({ description: "Amount in minor units (agorot)", example: 250000 })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ example: "2026-08-01" })
  @IsISO8601()
  incurredOn!: string;

  @ApiPropertyOptional({
    description: "The month this covers, as YYYY-MM. Required for a recurring cost; it is what stops the same month being entered twice.",
    example: "2026-08"
  })
  @IsOptional()
  @IsString()
  @Length(7, 7)
  periodLabel?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;
}

export class DecideOperatingCostDto {
  @ApiProperty({ description: "True to approve and split the cost three ways; false to reject it." })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional({ example: "Confirmed against the signed lease." })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class RecordCashSettlementDto {
  @ApiProperty({ description: "The driver handing cash over" })
  @IsUUID()
  driverUserId!: string;

  @ApiProperty({
    description: "A caller-supplied idempotency key, unique across all handovers. A retry with the same reference is refused rather than posted twice.",
    example: "HANDOVER-2026-08-18-001"
  })
  @IsString()
  @Length(3, 100)
  reference!: string;

  @ApiProperty({ description: "What the receiver actually counted, in minor units", example: 87500 })
  @IsInt()
  @Min(0)
  countedAmountMinor!: number;

  @ApiPropertyOptional({
    description: "Settle only these custody rows. Omit to settle the driver's outstanding orders oldest first.",
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  custodyIds?: string[];

  @ApiPropertyOptional({ example: "Driver reports one customer paid 5 short." })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  discrepancyNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class RecordPartnerSettlementDto {
  @ApiPropertyOptional({ description: "Pay a fixed partner (owner, delivery operations)" })
  @IsOptional()
  @IsUUID()
  partnerAccountId?: string;

  @ApiPropertyOptional({ description: "Pay a business what it is owed for its orders" })
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ description: "Pay a driver their earnings. Separate from cash handover." })
  @IsOptional()
  @IsUUID()
  driverUserId?: string;

  @ApiProperty({ example: 42000 })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ enum: partnerSettlementMethodValues })
  @IsIn(partnerSettlementMethodValues)
  method!: PartnerSettlementMethodValue;

  @ApiProperty({ description: "Idempotency key, unique across all payouts", example: "PAYOUT-2026-08-KHALDOUN" })
  @IsString()
  @Length(3, 100)
  reference!: string;

  @ApiPropertyOptional({ example: "2026-08-01" })
  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @ApiPropertyOptional({ example: "2026-08-31" })
  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class AdjustmentEntryDto {
  @ApiPropertyOptional({ description: 'A fixed partner, by key: "OWNER_A", "OWNER_B", "DELIVERY_OPS"' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  partnerKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverUserId?: string;

  @ApiProperty({
    description: "Signed. Positive credits the party, negative charges them.",
    example: -1500
  })
  @IsInt()
  amountMinor!: number;
}

export class RecordAdjustmentDto {
  @ApiPropertyOptional({ description: "The order record being corrected, when the correction concerns one order" })
  @IsOptional()
  @IsUUID()
  orderFinancialRecordId?: string;

  @ApiProperty({ example: "Driver was charged for a failed delivery after review of the CCTV." })
  @IsString()
  @Length(3, 500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  note?: string;

  @ApiProperty({ type: [AdjustmentEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustmentEntryDto)
  entries!: AdjustmentEntryDto[];
}

export class GenerateSubscriptionChargesDto {
  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2200)
  periodYear!: number;

  @ApiProperty({ example: 8 })
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth!: number;
}

/**
 * Every field is optional: a new rate set copies the one in force and restates only what changed,
 * so adjusting the commission cannot silently reset the margin split to its defaults.
 */
export class CreateRateSetDto {
  @ApiProperty({ description: "When these rates start applying", example: "2026-09-01T00:00:00.000Z" })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: "Commission reduced to 18% for the autumn campaign." })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;

  @ApiPropertyOptional({ description: "Basis points; 2000 = 20.00%" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  restaurantCommissionBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  promotionalCommissionBp?: number;

  @ApiPropertyOptional({ description: "Minor units per month; 15000 = 150.00 ILS" })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlySubscriptionMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  commissionOwnerAWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  commissionOwnerBWeight?: number;

  @ApiPropertyOptional({ description: "The three margin shares must total 10000" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  supermarketPartnerMarginBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ownerAMarginBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ownerBMarginBp?: number;

  @ApiPropertyOptional({ description: "The three cost shares must total 10000" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  supermarketPartnerCostBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ownerACostBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ownerBCostBp?: number;

  @ApiPropertyOptional({ description: "The driver's cut of the delivery fee; 7000 = 70.00%" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  driverDeliveryShareBp?: number;

  @ApiPropertyOptional({ description: "Weights dividing whatever the driver does not take" })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryOpsRemainderWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  ownerADeliveryRemainderWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  ownerBDeliveryRemainderWeight?: number;
}
