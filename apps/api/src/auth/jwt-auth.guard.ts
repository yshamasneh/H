import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { ApiException } from "../common/api.exception";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser, JwtPayload } from "./auth.types";

export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw unauthorized();
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET")
      });
    } catch {
      throw unauthorized();
    }

    if (payload.typ !== "access") {
      throw unauthorized();
    }

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
      throw unauthorized();
    }

    request.user = {
      id: session.user.id,
      fullName: session.user.fullName,
      phone: session.user.phone,
      role: session.user.role,
      sessionId: session.id,
      tokenVersion: session.user.tokenVersion
    };
    return true;
  }
}

function unauthorized(): ApiException {
  return new ApiException(401, "UNAUTHORIZED", "Your session is missing or has expired.");
}
