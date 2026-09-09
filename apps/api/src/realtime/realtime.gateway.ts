import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { JwtPayload } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { UserRole } from "../generated/prisma/client";
import { PushSenderService, type PushMessage } from "./push-sender.service";

export type SocketUser = { id: string; role: UserRole };

function extractToken(client: Socket): string | null {
  const fromAuth = client.handshake.auth?.token as string | undefined;
  if (fromAuth) return fromAuth;
  const header = client.handshake.headers.authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

@Injectable()
@WebSocketGateway({ transports: ["websocket", "polling"] })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly pushSender: PushSenderService
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const user = await this.authenticate(client);
    if (!user) {
      client.emit("error", { code: "UNAUTHORIZED", message: "Your session is missing or has expired." });
      client.disconnect(true);
      return;
    }

    client.data.user = user;
    await client.join(`user:${user.id}`);
    if (user.role === UserRole.ADMIN) {
      await client.join("admins");
    }
    if (user.role === UserRole.RESTAURANT) {
      // Joined from memberships rather than ownership, so every staff account on a business
      // receives its live order events, not only the owner.
      for (const businessId of await this.businessIdsForMember(user.id)) {
        await client.join(`restaurant:${businessId}`);
      }
    }
  }

  handleDisconnect(): void {
    // Socket.IO cleans up room membership automatically on disconnect.
  }

  @SubscribeMessage("order.subscribe")
  async handleOrderSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId?: string }
  ): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    if (!user || !data?.orderId) return;

    const order = await this.prisma.order.findUnique({ where: { id: data.orderId } });
    if (!order) return;

    const memberBusinessIds =
      user.role === UserRole.RESTAURANT ? await this.businessIdsForMember(user.id) : [];
    const allowed =
      user.role === UserRole.ADMIN ||
      (user.role === UserRole.CUSTOMER && order.customerId === user.id) ||
      (user.role === UserRole.RESTAURANT && memberBusinessIds.includes(order.restaurantId)) ||
      (user.role === UserRole.DRIVER && (await this.driverOwnsOrder(user.id, order.id)));

    if (allowed) {
      await client.join(`order:${data.orderId}`);
    }
  }

  /**
   * The socket layer has to enforce the same tenancy rule as HTTP; a permission model checked only
   * on REST would leak through the WebSocket.
   */
  private async businessIdsForMember(userId: string): Promise<string[]> {
    const memberships = await this.prisma.businessMember.findMany({
      where: { userId, isActive: true },
      select: { businessId: true }
    });
    return memberships.map((membership) => membership.businessId);
  }

  private async driverOwnsOrder(driverId: string, orderId: string): Promise<boolean> {
    const delivery = await this.prisma.delivery.findUnique({ where: { orderId } });
    return delivery?.driverId === driverId;
  }

  async authenticate(client: Socket): Promise<SocketUser | null> {
    const token = extractToken(client);
    if (!token) return null;

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET")
      });
    } catch {
      return null;
    }
    if (payload.typ !== "access") return null;

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      include: { user: true }
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.id !== payload.sub ||
      session.user.tokenVersion !== payload.ver ||
      !session.user.isActive ||
      !session.user.phoneVerifiedAt
    ) {
      return null;
    }

    return { id: session.user.id, role: session.user.role };
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.safeEmit(() => this.server.to(`user:${userId}`).emit(event, payload));
  }

  emitToRestaurant(restaurantId: string, event: string, payload: unknown): void {
    this.safeEmit(() => this.server.to(`restaurant:${restaurantId}`).emit(event, payload));
  }

  emitToOrder(orderId: string, event: string, payload: unknown): void {
    this.safeEmit(() => this.server.to(`order:${orderId}`).emit(event, payload));
  }

  emitToAdmins(event: string, payload: unknown): void {
    this.safeEmit(() => this.server.to("admins").emit(event, payload));
  }

  /**
   * Fire-and-forget device push, deliberately not awaited by callers (see `DeferredEmitter`):
   * a slow or failing Expo request must never hold up the HTTP response that triggered it.
   * `PushSenderService` never throws, so nothing here needs to catch again.
   */
  sendPush(userId: string, message: PushMessage): void {
    void this.pushSender.sendToUser(userId, message);
  }

  private safeEmit(emit: () => void): void {
    try {
      if (this.server) emit();
    } catch (error) {
      this.logger.warn(`Failed to emit realtime event: ${(error as Error).message}`);
    }
  }
}
