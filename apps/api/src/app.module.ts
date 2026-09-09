import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AccountingModule } from "./accounting/accounting.module";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { AuthorizationModule } from "./common/authorization/authorization.module";
import { validateEnvironment } from "./config/environment";
import { DriversModule } from "./drivers/drivers.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory/inventory.module";
import { LandmarksModule } from "./landmarks/landmarks.module";
import { UsersModule } from "./users/users.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OffersModule } from "./offers/offers.module";
import { ObservabilityModule } from "./observability/observability.module";
import { OrdersModule } from "./orders/orders.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { RestaurantsModule } from "./restaurants/restaurants.module";
import { SettingsModule } from "./settings/settings.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ["../../.env", ".env"],
      isGlobal: true,
      validate: validateEnvironment
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>("RATE_LIMIT_TTL_MS", 60_000),
          limit: config.get<number>("RATE_LIMIT_LIMIT", 400)
        }
      ]
    }),
    PrismaModule,
    AuthorizationModule,
    ObservabilityModule,
    RealtimeModule,
    AuthModule,
    HealthModule,
    InventoryModule,
    UsersModule,
    RestaurantsModule,
    OrdersModule,
    DriversModule,
    NotificationsModule,
    OffersModule,
    LandmarksModule,
    AccountingModule,
    SettingsModule,
    AdminModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
