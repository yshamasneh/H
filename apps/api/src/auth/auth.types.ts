import type { UserRole } from "../generated/prisma/enums";

export type PublicUser = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
};

export type AuthenticatedUser = PublicUser & {
  sessionId: string;
  tokenVersion: number;
};

export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds: number;
  user: PublicUser;
};

export type JwtPayload = {
  sub: string;
  role: UserRole;
  typ: "access" | "refresh";
  sid: string;
  ver: number;
  iat?: number;
  exp?: number;
};
