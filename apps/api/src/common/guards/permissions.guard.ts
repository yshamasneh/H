import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../../auth/jwt-auth.guard";
import { UserRole } from "../../generated/prisma/enums";
import { AuthorizationService } from "../authorization/authorization.service";
import { businessPermissions, type Permission } from "../authorization/permissions";
import { ApiException } from "../api.exception";
import { PERMISSIONS_KEY } from "../decorators/require-permission.decorator";

const businessScoped = new Set<string>(businessPermissions);

/**
 * Enforces `@RequirePermission` on the backend, so hiding a control in the UI is never what keeps
 * an operation safe. Runs after JwtAuthGuard, which has already established who the caller is.
 *
 * Business-scoped permissions are checked against the business this request resolves to. Business
 * accounts belong to exactly one business today (`Restaurant.ownerUserId` is unique), so `/me`
 * routes resolve unambiguously; a route that could target several businesses must set
 * `request.businessId` itself before this guard runs.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const resolved = await this.authorization.resolve(request.user.id, request.user.role);
    request.authorization = resolved;

    // A super admin holds every permission and acts across all businesses, so it must not be asked
    // to name a business the way a business account is.
    if (resolved.isSuperAdmin) return true;

    for (const permission of required) {
      const businessId = businessScoped.has(permission)
        ? request.businessId ?? AuthorizationService.soleBusinessId(resolved)
        : undefined;
      if (businessScoped.has(permission) && businessId === null) {
        throw new ApiException(
          403,
          "BUSINESS_CONTEXT_REQUIRED",
          "This action must name the business it applies to."
        );
      }
      if (!AuthorizationService.hasPermission(resolved, permission, businessId ?? undefined)) {
        throw forbidden(permission);
      }
      if (businessId) request.businessId = businessId;
    }
    return true;
  }
}

function forbidden(permission: Permission): ApiException {
  return new ApiException(
    403,
    "FORBIDDEN_PERMISSION",
    "Your account does not have permission to perform this action.",
    { requiredPermission: permission }
  );
}

/** Roles that never carry permissions, kept explicit so the guard's intent is readable. */
export const permissionlessRoles: UserRole[] = [UserRole.CUSTOMER, UserRole.DRIVER];
