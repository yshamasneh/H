import { rejectAdminRestaurant } from "./api";

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
