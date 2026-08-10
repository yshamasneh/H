import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { RoleScope, UserRole } from "../../generated/prisma/enums";
import { AuthorizationService, type AuthorizationContext } from "./authorization.service";
import { systemRolePermissions, systemRoleKeys } from "./permissions";

type FakeRole = { key: string; scope: RoleScope; permissions: string[] };

/** Minimal stand-in for the two queries AuthorizationService issues. */
function createService(options: {
  platformRole?: FakeRole | null;
  memberships?: { businessId: string; role: FakeRole }[];
}) {
  const prisma = {
    user: {
      findUnique: async () => ({ platformRole: options.platformRole ?? null })
    },
    businessMember: {
      findMany: async () =>
        (options.memberships ?? []).map((membership) => ({
          businessId: membership.businessId,
          role: membership.role
        }))
    }
  };
  return new AuthorizationService(prisma as never);
}

const superAdminRole: FakeRole = {
  key: systemRoleKeys.superAdmin,
  scope: RoleScope.PLATFORM,
  permissions: []
};
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

test("a super admin holds every permission implicitly, even ones its stored list omits", async () => {
  const service = createService({ platformRole: superAdminRole });
  const context = await service.resolve(randomUUID(), UserRole.ADMIN);

  assert.equal(context.isSuperAdmin, true);
  assert.equal(context.platformPermissions.size, 0);
  // Nothing was enumerated, yet every check passes — this is what stops a newly added permission
  // from silently excluding the platform owner.
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_USERS"), true);
  assert.equal(AuthorizationService.hasPermission(context, "VIEW_ACCOUNTING"), true);
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_PRICES", randomUUID()), true);
});

test("a platform role grants only the permissions it lists", async () => {
  const service = createService({
    platformRole: { key: "PLATFORM_SUPPORT", scope: RoleScope.PLATFORM, permissions: ["VIEW_ALL_ORDERS"] }
  });
  const context = await service.resolve(randomUUID(), UserRole.ADMIN);

  assert.equal(context.isSuperAdmin, false);
  assert.equal(AuthorizationService.hasPermission(context, "VIEW_ALL_ORDERS"), true);
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_USERS"), false);
});

test("an admin with no platform role assigned holds nothing", async () => {
  const service = createService({ platformRole: null });
  const context = await service.resolve(randomUUID(), UserRole.ADMIN);

  assert.equal(context.isSuperAdmin, false);
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_USERS"), false);
});

test("a business grant in one business never satisfies a request against another", async () => {
  const businessA = randomUUID();
  const businessB = randomUUID();
  const service = createService({
    memberships: [{ businessId: businessA, role: businessAdminRole }]
  });
  const context = await service.resolve(randomUUID(), UserRole.RESTAURANT);

  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_PRICES", businessA), true);
  // The whole point of scoping: the same permission against a different business is refused.
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_PRICES", businessB), false);
});

test("a business permission is refused when no business is named", async () => {
  const service = createService({
    memberships: [{ businessId: randomUUID(), role: businessAdminRole }]
  });
  const context = await service.resolve(randomUUID(), UserRole.RESTAURANT);

  // Without a business, only platform-scoped permissions are considered.
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_PRICES"), false);
});

test("business staff can work orders but cannot touch prices, menu, or settings", async () => {
  const businessId = randomUUID();
  const service = createService({ memberships: [{ businessId, role: businessStaffRole }] });
  const context = await service.resolve(randomUUID(), UserRole.RESTAURANT);

  assert.equal(AuthorizationService.hasPermission(context, "VIEW_ORDERS", businessId), true);
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_ORDERS", businessId), true);
  assert.equal(AuthorizationService.hasPermission(context, "VIEW_SALES", businessId), true);
  for (const denied of ["MANAGE_PRICES", "MANAGE_PRODUCTS", "MANAGE_MENU", "MANAGE_BUSINESS_SETTINGS"] as const) {
    assert.equal(
      AuthorizationService.hasPermission(context, denied, businessId),
      false,
      `${denied} must be denied to business staff`
    );
  }
});

test("business admin holds the staff permissions plus catalogue and settings control", async () => {
  const businessId = randomUUID();
  const service = createService({ memberships: [{ businessId, role: businessAdminRole }] });
  const context = await service.resolve(randomUUID(), UserRole.RESTAURANT);

  for (const granted of systemRolePermissions.BUSINESS_STAFF) {
    assert.equal(AuthorizationService.hasPermission(context, granted, businessId), true);
  }
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_PRICES", businessId), true);
  // Platform capabilities are still out of reach.
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_USERS"), false);
  assert.equal(AuthorizationService.hasPermission(context, "MANAGE_BUSINESSES"), false);
});

test("inactive memberships are not resolved as grants", async () => {
  // The service filters on isActive in its query; this asserts the resolved shape when none match.
  const service = createService({ memberships: [] });
  const context = await service.resolve(randomUUID(), UserRole.RESTAURANT);

  assert.deepEqual(context.businessGrants, []);
  assert.equal(AuthorizationService.soleBusinessId(context), null);
});

test("soleBusinessId resolves one membership and refuses to guess between several", () => {
  const businessA = randomUUID();
  const businessB = randomUUID();
  const base: AuthorizationContext = {
    userId: randomUUID(),
    isSuperAdmin: false,
    platformPermissions: new Set(),
    businessGrants: []
  };

  assert.equal(AuthorizationService.soleBusinessId(base), null);
  assert.equal(
    AuthorizationService.soleBusinessId({
      ...base,
      businessGrants: [{ businessId: businessA, roleKey: "BUSINESS_ADMIN", permissions: new Set() }]
    }),
    businessA
  );
  // Two memberships must force the route to name its business rather than silently pick one.
  assert.equal(
    AuthorizationService.soleBusinessId({
      ...base,
      businessGrants: [
        { businessId: businessA, roleKey: "BUSINESS_ADMIN", permissions: new Set() },
        { businessId: businessB, roleKey: "BUSINESS_STAFF", permissions: new Set() }
      ]
    }),
    null
  );
});

test("a business account's own role is never treated as a platform role", async () => {
  const businessId = randomUUID();
  const service = createService({ memberships: [{ businessId, role: businessAdminRole }] });
  const context = await service.resolve(randomUUID(), UserRole.RESTAURANT);

  assert.equal(context.isSuperAdmin, false);
  assert.equal(context.platformPermissions.size, 0);
});

test("a customer resolves to no permissions at all", async () => {
  const service = createService({ platformRole: superAdminRole, memberships: [{ businessId: randomUUID(), role: businessAdminRole }] });
  const context = await service.resolve(randomUUID(), UserRole.CUSTOMER);

  // Neither query runs for a customer, so a stray row could never grant them anything.
  assert.equal(context.isSuperAdmin, false);
  assert.equal(context.platformPermissions.size, 0);
  assert.deepEqual(context.businessGrants, []);
});
