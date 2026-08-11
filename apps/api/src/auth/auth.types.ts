import type { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/enums";

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

/**
 * What the interface needs to decide which sections to render. Advisory only: every operation is
 * still authorized server-side, so a client that ignores this gains nothing.
 */
export type AccessContextView = {
  isSuperAdmin: boolean;
  permissions: string[];
  roleKey: string | null;
  business: {
    id: string;
    name: string;
    businessType: BusinessType;
    status: RestaurantStatus;
    isOpen: boolean;
  } | null;
};
