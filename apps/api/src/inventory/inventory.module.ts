import { AdminStoreInventoryController } from "./admin-store-inventory.controller";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [InventoryController, AdminStoreInventoryController],
  providers: [InventoryService, JwtAuthGuard, RolesGuard]
})
export class InventoryModule {}
