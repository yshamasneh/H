import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { HealthController } from "./health.controller";

@Module({ imports: [AccountingModule], controllers: [HealthController] })
export class HealthModule {}
