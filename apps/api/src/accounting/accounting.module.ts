import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AccountingService } from "./accounting.service";
import { AdminAccountingController } from "./admin-accounting.controller";
import { BusinessAccountingController } from "./business-accounting.controller";
import { PartnerAccountsService } from "./partner-accounts.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAccountingController, BusinessAccountingController],
  providers: [AccountingService, PartnerAccountsService, JwtAuthGuard, RolesGuard],
  exports: [AccountingService]
})
export class AccountingModule {}
