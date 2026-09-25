import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PushDeliveryStatus } from "../generated/prisma/client";
import { PushSenderService } from "./push-sender.service";

type RecordShape = ReturnType<typeof makeDelivery>;

function makeDelivery(overrides: Record<string, any> = {}) {
  const id = randomUUID();
  const userId = overrides.notification?.userId ?? randomUUID();
  const pushTokenId = overrides.pushTokenId ?? randomUUID();
  return {
    id,
    notificationId: randomUUID(),
    pushTokenId,
    deduplicationKey: `notification:${id}`,
    status: PushDeliveryStatus.PENDING,
    attemptCount: 0,
    receiptAttemptCount: 0,
    nextAttemptAt: new Date(0),
    processingStartedAt: null as Date | null,
    expoTicketId: null as string | null,
    lastErrorCode: null as string | null,
    deliveredAt: null as Date | null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    notification: {
      id: randomUUID(),
      userId,
      businessId: null,
      type: "ORDER_PLACED",
      title: "New order",
      body: "A new order is waiting.",
      relatedEntityId: randomUUID(),
      isRead: false,
      createdAt: new Date(0),
      ...(overrides.notification ?? {})
    },
    pushToken: {
      id: pushTokenId,
      userId,
      token: `ExponentPushToken[${id}]`,
      platform: "android",
      isActive: true,
      lastRegisteredAt: new Date(0),
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...(overrides.pushToken ?? {})
    },
    ...overrides
  };
}

class FakePushPrisma {
  readonly deliveries: RecordShape[];
  readonly pushDelivery = {} as any;
  readonly pushToken = {} as any;

  constructor(deliveries: RecordShape[]) {
    this.deliveries = deliveries;
    this.pushDelivery.findMany = async ({ where, take }: any) => this.deliveries
      .filter((delivery) => matchesWhere(delivery, where))
      .sort((left, right) => left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime())
      .slice(0, take)
      .map(cloneDelivery);
    this.pushDelivery.updateMany = async ({ where, data }: any) => {
      const matches = this.deliveries.filter((delivery) => matchesWhere(delivery, where));
      for (const delivery of matches) applyData(delivery, data);
      return { count: matches.length };
    };
    this.pushDelivery.update = async ({ where, data }: any) => {
      const delivery = this.deliveries.find((entry) => entry.id === where.id);
      if (!delivery) throw new Error("missing push delivery");
      applyData(delivery, data);
      return cloneDelivery(delivery);
    };
    this.pushDelivery.count = async ({ where }: any) =>
      this.deliveries.filter((delivery) => matchesWhere(delivery, where)).length;
    this.pushToken.updateMany = async ({ where, data }: any) => {
      const tokens = new Map(this.deliveries.map((delivery) => [delivery.pushToken.id, delivery.pushToken]));
      const token = tokens.get(where.id);
      if (!token) return { count: 0 };
      Object.assign(token, data);
      for (const delivery of this.deliveries) {
        if (delivery.pushToken.id === where.id) Object.assign(delivery.pushToken, data);
      }
      return { count: 1 };
    };
  }
}

function matchesWhere(delivery: RecordShape, where: any): boolean {
  if (where.id !== undefined && delivery.id !== where.id) return false;
  if (where.status?.in && !where.status.in.includes(delivery.status)) return false;
  if (typeof where.status === "string" && delivery.status !== where.status) return false;
  if (where.nextAttemptAt?.lte && delivery.nextAttemptAt > where.nextAttemptAt.lte) return false;
  if (where.processingStartedAt?.lte && (!delivery.processingStartedAt || delivery.processingStartedAt > where.processingStartedAt.lte)) return false;
  if (where.attemptCount?.lt !== undefined && delivery.attemptCount >= where.attemptCount.lt) return false;
  if (where.attemptCount?.gte !== undefined && delivery.attemptCount < where.attemptCount.gte) return false;
  if (where.receiptAttemptCount?.lt !== undefined && delivery.receiptAttemptCount >= where.receiptAttemptCount.lt) return false;
  if (where.receiptAttemptCount?.gte !== undefined && delivery.receiptAttemptCount < where.receiptAttemptCount.gte) return false;
  if (where.expoTicketId?.not === null && delivery.expoTicketId === null) return false;
  if (where.expoTicketId === null && delivery.expoTicketId !== null) return false;
  return true;
}

function applyData(delivery: RecordShape, data: Record<string, any>): void {
  for (const [key, value] of Object.entries(data)) {
    (delivery as any)[key] = value && typeof value === "object" && "increment" in value
      ? (delivery as any)[key] + value.increment
      : value;
  }
  delivery.updatedAt = new Date();
}

function cloneDelivery(delivery: RecordShape): RecordShape {
  return { ...delivery, notification: { ...delivery.notification }, pushToken: { ...delivery.pushToken } };
}

function config(overrides: Record<string, unknown> = {}) {
  return { get: (key: string, fallback: unknown) => overrides[key] ?? fallback };
}

function service(prisma: FakePushPrisma, overrides: Record<string, unknown> = {}) {
  return new PushSenderService(prisma as never, config({
    PUSH_WORKER_MAX_BATCHES_PER_RUN: 10,
    PUSH_RETRY_BASE_MS: 1_000,
    PUSH_RETRY_MAX_MS: 60_000,
    ...overrides
  }) as never);
}

async function withFetch(handler: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function sendTickets(init: RequestInit, prefix = "ticket") {
  const messages = JSON.parse(init.body as string) as unknown[];
  return new Response(JSON.stringify({ data: messages.map((_, index) => ({ status: "ok", id: `${prefix}-${index}` })) }), { status: 200 });
}

test("a successful ticket and receipt mark the delivery delivered", async () => {
  const delivery = makeDelivery();
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma);
  let request = 0;

  await withFetch((async (_url: string, init: RequestInit) => {
    request += 1;
    return request === 1
      ? sendTickets(init)
      : new Response(JSON.stringify({ data: { "ticket-0": { status: "ok" } } }), { status: 200 });
  }) as never, async () => {
    await worker.processOnce();
    assert.equal(delivery.status, PushDeliveryStatus.AWAITING_RECEIPT);
    delivery.nextAttemptAt = new Date(0);
    await worker.processOnce();
  });

  assert.equal(delivery.status, PushDeliveryStatus.DELIVERED);
  assert.ok(delivery.deliveredAt);
});

test("provider timeout leaves a durable retryable delivery with exponential backoff", async () => {
  const delivery = makeDelivery();
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma, { PUSH_PROVIDER_TIMEOUT_MS: 5 });
  const startedAt = Date.now();

  await withFetch(((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as never, async () => worker.processOnce());

  assert.equal(delivery.status, PushDeliveryStatus.RETRYABLE_FAILED);
  assert.equal(delivery.lastErrorCode, "EXPO_TIMEOUT");
  assert.ok(delivery.nextAttemptAt.getTime() >= startedAt + 1_000);
  assert.equal(delivery.attemptCount, 1);
});

test("a transient 5xx is retried and the next attempt can succeed", async () => {
  const delivery = makeDelivery();
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma);
  let request = 0;
  await withFetch((async (_url: string, init: RequestInit) => {
    request += 1;
    return request === 1 ? new Response("unavailable", { status: 503 }) : sendTickets(init);
  }) as never, async () => {
    await worker.processOnce();
    assert.equal(delivery.status, PushDeliveryStatus.RETRYABLE_FAILED);
    delivery.nextAttemptAt = new Date(0);
    await worker.processOnce();
  });
  assert.equal(delivery.status, PushDeliveryStatus.AWAITING_RECEIPT);
  assert.equal(delivery.attemptCount, 2);
});

test("maximum send attempts produce a permanent failure", async () => {
  const delivery = makeDelivery({ attemptCount: 5 });
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma, { PUSH_MAX_ATTEMPTS: 6 });
  await withFetch((async () => new Response("unavailable", { status: 503 })) as never, async () => worker.processOnce());
  assert.equal(delivery.status, PushDeliveryStatus.PERMANENT_FAILED);
  assert.equal(delivery.lastErrorCode, "MAX_SEND_ATTEMPTS");
  assert.equal(delivery.attemptCount, 6);
});

test("a stale processing claim is recovered after a worker crash", async () => {
  const delivery = makeDelivery({
    status: PushDeliveryStatus.PROCESSING,
    processingStartedAt: new Date(Date.now() - 300_000)
  });
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma, { PUSH_PROCESSING_STALE_MS: 1_000 });
  await withFetch((async (_url: string, init: RequestInit) => sendTickets(init)) as never, async () => worker.processOnce());
  assert.equal(delivery.status, PushDeliveryStatus.AWAITING_RECEIPT);
  assert.equal(delivery.attemptCount, 1);
});

test("two workers cannot claim and send the same delivery", async () => {
  const delivery = makeDelivery();
  const prisma = new FakePushPrisma([delivery]);
  const first = service(prisma);
  const second = service(prisma);
  let sendCount = 0;
  await withFetch((async (_url: string, init: RequestInit) => {
    sendCount += 1;
    return sendTickets(init);
  }) as never, async () => Promise.all([first.processOnce(), second.processOnce()]).then(() => undefined));
  assert.equal(sendCount, 1);
  assert.equal(delivery.attemptCount, 1);
});

test("more than 100 deliveries are split into Expo-compatible batches", async () => {
  const deliveries = Array.from({ length: 150 }, () => makeDelivery());
  const prisma = new FakePushPrisma(deliveries);
  const worker = service(prisma);
  const batchSizes: number[] = [];
  await withFetch((async (_url: string, init: RequestInit) => {
    batchSizes.push((JSON.parse(init.body as string) as unknown[]).length);
    return sendTickets(init, `ticket-${batchSizes.length}`);
  }) as never, async () => worker.processOnce());
  assert.deepEqual(batchSizes, [100, 50]);
});

test("a missing receipt remains pending and a later success completes it", async () => {
  const delivery = makeDelivery({
    status: PushDeliveryStatus.AWAITING_RECEIPT,
    expoTicketId: "receipt-later"
  });
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma);
  let poll = 0;
  await withFetch((async () => {
    poll += 1;
    return new Response(JSON.stringify({ data: poll === 1 ? {} : { "receipt-later": { status: "ok" } } }), { status: 200 });
  }) as never, async () => {
    await worker.processOnce();
    assert.equal(delivery.status, PushDeliveryStatus.AWAITING_RECEIPT);
    delivery.nextAttemptAt = new Date(0);
    await worker.processOnce();
  });
  assert.equal(delivery.status, PushDeliveryStatus.DELIVERED);
  assert.equal(delivery.receiptAttemptCount, 2);
});

test("DeviceNotRegistered deactivates only the affected token", async () => {
  const affected = makeDelivery({ status: PushDeliveryStatus.AWAITING_RECEIPT, expoTicketId: "dead" });
  const healthy = makeDelivery({ status: PushDeliveryStatus.AWAITING_RECEIPT, expoTicketId: "healthy" });
  const prisma = new FakePushPrisma([affected, healthy]);
  const worker = service(prisma);
  await withFetch((async () => new Response(JSON.stringify({ data: {
    dead: { status: "error", details: { error: "DeviceNotRegistered" } },
    healthy: { status: "ok" }
  } }), { status: 200 })) as never, async () => worker.processOnce());
  assert.equal(affected.pushToken.isActive, false);
  assert.equal(affected.status, PushDeliveryStatus.PERMANENT_FAILED);
  assert.equal(healthy.pushToken.isActive, true);
  assert.equal(healthy.status, PushDeliveryStatus.DELIVERED);
});

test("a malformed token is a permanent failure and is never sent", async () => {
  const delivery = makeDelivery({ pushToken: { ...makeDelivery().pushToken, token: "not-an-expo-token" } });
  delivery.pushToken.id = delivery.pushTokenId;
  delivery.pushToken.userId = delivery.notification.userId;
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma);
  let fetched = false;
  await withFetch((async () => {
    fetched = true;
    return new Response("{}", { status: 200 });
  }) as never, async () => worker.processOnce());
  assert.equal(fetched, false);
  assert.equal(delivery.status, PushDeliveryStatus.PERMANENT_FAILED);
  assert.equal(delivery.lastErrorCode, "MALFORMED_PUSH_TOKEN");
  assert.equal(delivery.pushToken.isActive, false);
});

test("structured failure logs never contain the complete push token", async () => {
  const secretToken = "ExponentPushToken[do-not-log-this-complete-token]";
  const delivery = makeDelivery({ pushToken: { ...makeDelivery().pushToken, token: secretToken } });
  delivery.pushToken.id = delivery.pushTokenId;
  delivery.pushToken.userId = delivery.notification.userId;
  const prisma = new FakePushPrisma([delivery]);
  const worker = service(prisma);
  const logs: string[] = [];
  (worker as any).logger = { warn: (line: string) => logs.push(line), log: (line: string) => logs.push(line) };
  await withFetch((async () => new Response("unavailable", { status: 503 })) as never, async () => worker.processOnce());
  assert.ok(logs.length > 0);
  assert.equal(logs.some((line) => line.includes(secretToken)), false);
});

function deliveryFor(type: string, platform: string): RecordShape {
  const delivery = makeDelivery();
  delivery.notification.type = type;
  delivery.pushToken.platform = platform;
  return delivery;
}

async function sentPayload(delivery: RecordShape): Promise<Record<string, unknown>> {
  const worker = service(new FakePushPrisma([delivery]));
  let payload: Record<string, unknown> = {};
  await withFetch((async (_url: string, init: RequestInit) => {
    [payload] = JSON.parse(init.body as string) as Record<string, unknown>[];
    return sendTickets(init);
  }) as never, async () => worker.processOnce());
  return payload;
}

test("a delivery alert to an Android driver targets the delivery-alerts channel and expires if not delivered promptly", async () => {
  const payload = await sentPayload(
    deliveryFor("DELIVERY_AVAILABLE", "android")
  );

  assert.equal(payload.channelId, "delivery-alerts");
  assert.equal(payload.ttl, 120);
  assert.equal(payload.priority, "high");
  assert.equal(payload.sound, "default", "Android takes the JOVO sound from the channel, not the message");
});

test("a delivery alert to an iOS driver names the bundled JOVO sound file", async () => {
  const payload = await sentPayload(
    deliveryFor("DELIVERY_AVAILABLE", "ios")
  );

  assert.equal(payload.sound, "jovo_delivery.wav");
  assert.equal(payload.channelId, "delivery-alerts");
});

test("ordinary notifications keep the default sound and no expiry, and go to the app's order-updates channel", async () => {
  const payload = await sentPayload(deliveryFor("ORDER_PLACED", "android"));

  assert.equal(payload.sound, "default");
  // The high-importance channel the app creates for order updates, not the JOVO delivery-alert one.
  assert.equal(payload.channelId, "orders");
  assert.equal("ttl" in payload, false);
});
