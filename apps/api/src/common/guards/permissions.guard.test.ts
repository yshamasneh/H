import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { RoleScope, UserRole } from "../../generated/prisma/enums";
import { ApiException } from "../api.exception";
import { AuthorizationService } from "../authorization/authorization.service";
import { systemRolePermissions, systemRoleKeys, type Permission } from "../authorization/permissions";
import { PermissionsGuard } from "./permissions.guard";

type FakeRole = { key: string; scope: RoleScope; permissions: string[] };

function createHarness(options: {
  required: Permission[] | undefined;
  role: UserRole;
  platformRole?: FakeRole | null;
  memberships?: { businessId: string; role: FakeRole }[];
  businessId?: string;
}) {
  const prisma = {
    user: { findUnique: async () => ({ platformRole: options.platformRole ?? null }) },
    businessMember: {
      findMany: async () =>
        (options.memberships ?? []).map((m) => ({ businessId: m.businessId, role: m.role }))
    }
  };
  const reflector = { getAllAndOverride: () => options.required };
  const guard = new PermissionsGuard(reflector as never, new AuthorizationService(prisma as never));
  const request = {
    user: { id: randomUUID(), role: options.role },
    businessId: options.businessId
  } as Record<string, unknown>;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request })
  };
  return { guard, context: context as never, request };
}

const superAdminRole: FakeRole = { key: systemRoleKeys.superAdmin, scope: RoleScope.PLATFORM, permissions: [] };
const businessAdminRole: FakeRole = {
  key: systemRoleKeys.businessAdmin,
  scope: RoleScope.BUSINESS,
  permissions: [...systemRolePermissions.BUSINESS_ADMIN]
};
const businessStaffRole: FakeRole = {
  key: systemRoleKeys.businessStaff,
  scope: RoleScope.BUSINESS,
  permissions: [...systemRolePermissions.BUSINESS_STAFF]
};

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

test("a route with no required permission is allowed through untouched", async () => {
  const { guard, context, request } = createHarness({ required: undefined, role: UserRole.CUSTOMER });
  assert.equal(await guard.canActivate(context), true);
  // Nothing was resolved, so no needless query ran.
  assert.equal(request.authorization, undefined);
});

test("an empty permission list is treated as no requirement", async () => {
  const { guard, context } = createHarness({ required: [], role: UserRole.CUSTOMER });
  assert.equal(await guard.canActivate(context), true);
});

test("a super admin passes a platform permission and a business permission without a business", async () => {
  const { guard, context } = createHarness({
    required: ["MANAGE_USERS", "MANAGE_PRICES"],
    role: UserRole.ADMIN,
    platformRole: superAdminRole
  });
  // A platform owner must never be asked to name a business the way a business account is.
  assert.equal(await guard.canActivate(context), true);
});

test("an admin without the required platform permission is refused by the backend", async () => {
  const { guard, context } = createHarness({
    required: ["MANAGE_USERS"],
    role: UserRole.ADMIN,
    platformRole: { key: "PLATFORM_SUPPORT", scope: RoleScope.PLATFORM, permissions: ["VIEW_ALL_ORDERS"] }
  });
  await assert.rejects(guard.canActivate(context), hasCode("FORBIDDEN_PERMISSION"));
});

test("the refusal names the permission that was missing", async () => {
  const { guard, context } = createHarness({
    required: ["MANAGE_ROLES"],
    role: UserRole.ADMIN,
    platformRole: { key: "PLATFORM_SUPPORT", scope: RoleScope.PLATFORM, permissions: [] }
  });
  await assert.rejects(guard.canActivate(context), (error: unknown) => {
    const body = (error as ApiException).getResponse() as { details?: { requiredPermission?: string } };
    return body.details?.requiredPermission === "MANAGE_ROLES";
  });
});

test("a business permission resolves against the caller's single business", async () => {
  const businessId = randomUUID();
  const { guard, context, request } = createHarness({
    required: ["MANAGE_PRICES"],
    role: UserRole.RESTAURANT,
    memberships: [{ businessId, role: businessAdminRole }]
  });

  assert.equal(await guard.canActivate(context), true);
  // The resolved business is handed to the handler so it never has to re-derive it.
  assert.equal(request.businessId, businessId);
});

test("business staff are refused a permission their role does not grant", async () => {
  const businessId = randomUUID();
  const { guard, context } = createHarness({
    required: ["MANAGE_PRICES"],
    role: UserRole.RESTAURANT,
    memberships: [{ businessId, role: businessStaffRole }]
  });
  // This is the §14 requirement: hiding the button is not what protects the price.
  await assert.rejects(guard.canActivate(context), hasCode("FORBIDDEN_PERMISSION"));
});

test("a permission held in another business does not unlock the business named on the request", async () => {
  const businessA = randomUUID();
  const businessB = randomUUID();
  const { guard, context } = createHarness({
    required: ["MANAGE_PRICES"],
    role: UserRole.RESTAURANT,
    memberships: [{ businessId: businessA, role: businessAdminRole }],
    businessId: businessB
  });
  await assert.rejects(guard.canActivate(context), hasCode("FORBIDDEN_PERMISSION"));
});

test("a caller belonging to several businesses must name the one they mean", async () => {
  const { guard, context } = createHarness({
    required: ["MANAGE_PRICES"],
    role: UserRole.RESTAURANT,
    memberships: [
      { businessId: randomUUID(), role: businessAdminRole },
      { businessId: randomUUID(), role: businessAdminRole }
    ]
  });
  await assert.rejects(guard.canActivate(context), hasCode("BUSINESS_CONTEXT_REQUIRED"));
});

test("a business account with no membership at all is refused", async () => {
  const { guard, context } = createHarness({
    required: ["VIEW_ORDERS"],
    role: UserRole.RESTAURANT,
    memberships: []
  });
  await assert.rejects(guard.canActivate(context), hasCode("BUSINESS_CONTEXT_REQUIRED"));
});

test("every required permission must be held, not just the first", async () => {
  const businessId = randomUUID();
  const { guard, context } = createHarness({
    // Staff hold VIEW_ORDERS but not MANAGE_PRICES.
    required: ["VIEW_ORDERS", "MANAGE_PRICES"],
    role: UserRole.RESTAURANT,
    memberships: [{ businessId, role: businessStaffRole }]
  });
  await assert.rejects(guard.canActivate(context), hasCode("FORBIDDEN_PERMISSION"));
});

test("a customer cannot reach a permissioned route even if one is somehow requested", async () => {
  const { guard, context } = createHarness({
    required: ["VIEW_ORDERS"],
    role: UserRole.CUSTOMER
  });
  await assert.rejects(guard.canActivate(context), hasCode("BUSINESS_CONTEXT_REQUIRED"));
});

test("a driver holds no permissions", async () => {
  const { guard, context } = createHarness({
    required: ["MANAGE_DRIVERS"],
    role: UserRole.DRIVER
  });
  await assert.rejects(guard.canActivate(context), hasCode("FORBIDDEN_PERMISSION"));
});
