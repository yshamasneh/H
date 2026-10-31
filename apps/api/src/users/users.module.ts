import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AccountDeletionSweepService } from "./account-deletion-sweep.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, AccountDeletionSweepService, JwtAuthGuard]
})
export class UsersModule {}
