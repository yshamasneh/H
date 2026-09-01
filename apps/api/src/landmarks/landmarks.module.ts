import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminLandmarksController } from "./admin-landmarks.controller";
import { LandmarksController } from "./landmarks.controller";
import { LandmarksService } from "./landmarks.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminLandmarksController, LandmarksController],
  providers: [LandmarksService, JwtAuthGuard, RolesGuard],
  exports: [LandmarksService]
})
export class LandmarksModule {}
