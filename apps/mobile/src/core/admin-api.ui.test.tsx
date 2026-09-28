import { fetchAdminAccess, getAdminCustomerDetail, listAdminUsers, rejectAdminRestaurant, setAdminUserActive } from "./api";

test("mobile admin rejection sends the required reason in the API request body", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "restaurant-1", status: "REJECTED" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );

  try {
    await rejectAdminRestaurant("admin-access-token", "restaurant-1", "  Missing license documents  ");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/admin/restaurants/restaurant-1/reject");
    expect(init).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ reason: "Missing license documents" })
    }));
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer admin-access-token");
  } finally {
    fetchMock.mockRestore();
  }
});

function mockJson(body: unknown) {
  return jest.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
  );
}

test("the users list and customer detail use the same endpoints as the admin web console", async () => {
  const fetchMock = mockJson({ items: [], page: 1, pageSize: 20, total: 0 });
  try {
    await listAdminUsers("t", { audience: "STAFF", role: "DRIVER", search: "0599", page: 2, pageSize: 20 });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/v1/admin/users?audience=STAFF&role=DRIVER&search=0599&page=2&pageSize=20"
    );
    await getAdminCustomerDetail("t", "c1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/v1/admin/users/c1/customer-detail");
  } finally {
    fetchMock.mockRestore();
  }
});

test("suspending an account sends PATCH with the trimmed reason", async () => {
  const fetchMock = mockJson({ id: "c1", isActive: false });
  try {
    await setAdminUserActive("t", "c1", false, "  Abusive calls  ");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/admin/users/c1/active");
    expect(init).toEqual(expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ isActive: false, reason: "Abusive calls" })
    }));
  } finally {
    fetchMock.mockRestore();
  }
});

test("the access context is read from /auth/me and defaults to no permissions", async () => {
  let fetchMock = mockJson({ user: {}, access: { isSuperAdmin: false, permissions: ["MANAGE_USERS"] } });
  try {
    expect(await fetchAdminAccess("t")).toEqual({ isSuperAdmin: false, permissions: ["MANAGE_USERS"] });
  } finally {
    fetchMock.mockRestore();
  }
  fetchMock = mockJson({ user: {} });
  try {
    expect(await fetchAdminAccess("t")).toEqual({ isSuperAdmin: false, permissions: [] });
  } finally {
    fetchMock.mockRestore();
  }
});
