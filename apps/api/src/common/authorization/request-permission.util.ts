import type { AuthenticatedRequest } from "../../auth/jwt-auth.guard";
import { ApiException } from "../api.exception";
import { AuthorizationService } from "./authorization.service";
import { businessPermissions, type Permission } from "./permissions";

const businessScoped = new Set<string>(businessPermissions);

/**
 * Reads a permission the caller holds, using the context PermissionsGuard already resolved.
 *
 * This exists for field-level rules a route-level decorator cannot express — for example that
 * editing a product needs MANAGE_PRODUCTS but changing its price additionally needs MANAGE_PRICES.
 * Fails closed if the guard never ran, so a route that forgets it cannot silently grant anything.
 */
export function requestHoldsPermission(request: AuthenticatedRequest, permission: Permission): boolean {
  const context = request.authorization;
  if (!context) {
    throw new ApiException(
      500,
      "AUTHORIZATION_NOT_RESOLVED",
      "This action could not be authorized. Please try again.",
      { permission }
    );
  }
  const businessId = businessScoped.has(permission)
    ? request.businessId ?? AuthorizationService.soleBusinessId(context) ?? undefined
    : undefined;
  return AuthorizationService.hasPermission(context, permission, businessId);
}
