import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    // The pool config is passed straight through to the underlying `pg` Pool. Its own default
    // `max` is 10, which caps the whole API at 10 concurrent DB operations regardless of how many
    // cores or Postgres connections are available — the connection-pool bottleneck surfaced by load
    // testing. DATABASE_POOL_MAX makes it tunable per deployment (validated in environment.ts).
    const connectionTimeoutMillis = config.get<number>("DATABASE_POOL_CONNECTION_TIMEOUT_MS", 0);
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>("DATABASE_URL"),
      max: config.get<number>("DATABASE_POOL_MAX", 20),
      ...(connectionTimeoutMillis > 0 ? { connectionTimeoutMillis } : {})
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
