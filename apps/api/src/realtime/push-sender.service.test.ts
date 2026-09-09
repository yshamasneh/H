import assert from "node:assert/strict";
import { test } from "node:test";
import { PushSenderService } from "./push-sender.service";

function fakePrisma(tokens: { id: string; token: string }[]) {
  const updateManyCalls: { where: { id: { in: string[] } }; data: { isActive: boolean } }[] = [];
  return {
    pushToken: {
      findMany: async () => tokens,
      updateMany: async (args: (typeof updateManyCalls)[number]) => {
        updateManyCalls.push(args);
        return { count: args.where.id.in.length };
      }
    },
    updateManyCalls
  };
}

function withFetch(handler: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("does nothing when the user has no active push tokens", async () => {
  const prisma = fakePrisma([]);
  const service = new PushSenderService(prisma as never);
  let called = false;

  await withFetch(
    (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as never,
    async () => {
      await service.sendToUser("user-1", { title: "New order", body: "Order #123" });
    }
  );

  assert.equal(called, false);
});

test("sends one Expo push request per token batch and never throws on failure", async () => {
  const prisma = fakePrisma([{ id: "t1", token: "ExponentPushToken[aaa]" }]);
  const service = new PushSenderService(prisma as never);
  const requests: unknown[] = [];

  await withFetch(
    (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 });
    }) as never,
    async () => {
      await service.sendToUser("user-1", { title: "New order", body: "Order #123", data: { orderId: "o1" } });
    }
  );

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], [
    {
      to: "ExponentPushToken[aaa]",
      title: "New order",
      body: "Order #123",
      data: { orderId: "o1" },
      sound: "default",
      priority: "high"
    }
  ]);
});

test("deactivates a token whose ticket reports DeviceNotRegistered", async () => {
  const prisma = fakePrisma([{ id: "dead-token-id", token: "ExponentPushToken[dead]" }]);
  const service = new PushSenderService(prisma as never);

  await withFetch(
    (async () =>
      new Response(
        JSON.stringify({ data: [{ status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }] }),
        { status: 200 }
      )) as never,
    async () => {
      await service.sendToUser("user-1", { title: "t", body: "b" });
    }
  );

  assert.equal(prisma.updateManyCalls.length, 1);
  assert.deepEqual(prisma.updateManyCalls[0].where.id.in, ["dead-token-id"]);
  assert.equal(prisma.updateManyCalls[0].data.isActive, false);
});

test("a network failure is swallowed rather than thrown", async () => {
  const prisma = fakePrisma([{ id: "t1", token: "ExponentPushToken[aaa]" }]);
  const service = new PushSenderService(prisma as never);

  await withFetch(
    (async () => {
      throw new Error("network is down");
    }) as never,
    async () => {
      await assert.doesNotReject(service.sendToUser("user-1", { title: "t", body: "b" }));
    }
  );
});

test("a non-DeviceNotRegistered ticket error is logged but leaves the token active", async () => {
  const prisma = fakePrisma([{ id: "t1", token: "ExponentPushToken[aaa]" }]);
  const service = new PushSenderService(prisma as never);

  await withFetch(
    (async () =>
      new Response(JSON.stringify({ data: [{ status: "error", message: "rate limited" }] }), { status: 200 })) as never,
    async () => {
      await service.sendToUser("user-1", { title: "t", body: "b" });
    }
  );

  assert.equal(prisma.updateManyCalls.length, 0);
});

test("batches requests at 100 tokens per Expo push call", async () => {
  const tokens = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, token: `ExponentPushToken[${i}]` }));
  const prisma = fakePrisma(tokens);
  const service = new PushSenderService(prisma as never);
  const batchSizes: number[] = [];

  await withFetch(
    (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as unknown[];
      batchSizes.push(body.length);
      return new Response(JSON.stringify({ data: body.map(() => ({ status: "ok" })) }), { status: 200 });
    }) as never,
    async () => {
      await service.sendToUser("user-1", { title: "t", body: "b" });
    }
  );

  assert.deepEqual(batchSizes, [100, 50]);
});
