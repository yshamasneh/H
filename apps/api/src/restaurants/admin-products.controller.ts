import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserRole } from "../generated/prisma/client";
import { ProductReviewService } from "./product-review.service";

export class ProductReviewQueryDto {
  @ApiPropertyOptional({ enum: ["PENDING_REVIEW", "APPROVED"] })
  @IsOptional()
  @IsIn(["PENDING_REVIEW", "APPROVED"])
  reviewStatus?: "PENDING_REVIEW" | "APPROVED";

  @ApiPropertyOptional({ description: "Name, SKU, or barcode (exact or prefix)" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class ApproveProductsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID("all", { each: true })
  itemIds!: string[];
}

/** Run 3, task 2: same guards and permission as the existing admin product editing routes. */
@ApiTags("admin-products")
@ApiBearerAuth()
@Controller("admin/products")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission("MANAGE_BUSINESSES")
export class AdminProductsController {
  constructor(private readonly review: ProductReviewService) {}

  @Get()
  @ApiOperation({ summary: "All products across stores, filterable by review status, with the pending-review count" })
  list(@Query() query: ProductReviewQueryDto) {
    return this.review.list({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 50 });
  }

  @Post("approve")
  @ApiOperation({ summary: "Approve one or many pending products (restricted products are refused and reported)" })
  approve(@Req() request: AuthenticatedRequest, @Body() input: ApproveProductsDto) {
    return this.review.approve(request.user.id, input.itemIds);
  }
}
