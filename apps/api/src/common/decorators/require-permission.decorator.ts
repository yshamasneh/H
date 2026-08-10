import { SetMetadata } from "@nestjs/common";
import type { Permission } from "../authorization/permissions";

export const PERMISSIONS_KEY = "requiredPermissions";

/**
 * Requires every listed permission. Business-scoped permissions are checked against the business
 * the request resolves to, never merely "some business the actor belongs to".
 */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
