import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RealtimeGateway } from "./realtime.gateway";
import { PushSenderService } from "./push-sender.service";

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, PushSenderService],
  exports: [RealtimeGateway]
})
export class RealtimeModule {}
