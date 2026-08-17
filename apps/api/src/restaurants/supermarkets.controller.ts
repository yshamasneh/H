import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupermarketCatalogQueryDto, SupermarketListQueryDto } from "./restaurants.dto";
import { RestaurantsService } from "./restaurants.service";

@ApiTags("supermarkets")
@Controller("supermarkets")
export class SupermarketsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  @ApiOperation({ summary: "List approved supermarkets (open only unless includeClosed is set)" })
  list(@Query() query: SupermarketListQueryDto) {
    return this.restaurants.listPublicSupermarkets(query.page ?? 1, query.pageSize ?? 20, query.includeClosed ?? false);
  }

  @Get(":supermarketId/catalog")
  @ApiOperation({ summary: "Browse and search a supermarket catalog by department" })
  catalog(
    @Param("supermarketId", new ParseUUIDPipe()) supermarketId: string,
    @Query() query: SupermarketCatalogQueryDto
  ) {
    return this.restaurants.getSupermarketCatalog(supermarketId, query);
  }

  @Get(":supermarketId/products/:productId")
  @ApiOperation({ summary: "Get a supermarket product detail" })
  product(
    @Param("supermarketId", new ParseUUIDPipe()) supermarketId: string,
    @Param("productId", new ParseUUIDPipe()) productId: string
  ) {
    return this.restaurants.getSupermarketProduct(supermarketId, productId);
  }
}
