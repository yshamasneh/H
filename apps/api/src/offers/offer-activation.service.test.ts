import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { OfferActivationNotifierService } from "./offer-activation.service";

type FakeOffer = {
  id: string;
  title: string;
  isActive: boolean;
  activationNotifiedAt: Date | null;
  startsAt: Date;
  endsAt: Date | null;
};

type FakeUser = { id: string; role: string; isActive: boolean };

function createFakePrisma() {
  const offers: FakeOffer[] = [];
  const users: FakeUser[] = [];
  const notifications: { id: string; userId: string; type: string; title: string; body: string }[] = [];

  const prisma = {
    offer: {
      findMany: async ({ where, orderBy, take }: any) => {
        const now = new Date();
        let matches = offers.filter((offer) =>
          offer.isActive === where.isActive
          && offer.activationNotifiedAt === null
          && offer.startsAt.getTime() <= now.getTime()
          && (offer.endsAt === null || offer.endsAt.getTime() > now.getTime())
        );
        if (orderBy?.startsAt === "asc") matches = [...matches].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        return typeof take === "number" ? matches.slice(0, take) : matches;
      },
      updateMany: async ({ where, data }: any) => {
        const offer = offers.find((item) => item.id === where.id && item.activationNotifiedAt === null);
        if (!offer) return { count: 0 };
        offer.activationNotifiedAt = data.activationNotifiedAt;
        return { count: 1 };
      }
    },
    user: {
      findMany: async ({ where }: any) => users.filter((user) => user.role === where.role && user.isActive === where.isActive)
    },
    pushToken: {
      findMany: async () => []
    },
    notification: {
      createMany: async ({ data }: any) => {
        notifications.push(...data);
        return { count: data.length };
      }
    },
    pushDelivery: {
      createMany: async () => ({ count: 0 })
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations)
  };

  return {
    prisma,
    offers,
    users,
    notifications,
    seedOffer(overrides: Partial<FakeOffer> = {}): FakeOffer {
      const offer: FakeOffer = {
        id: randomUUID(),
        title: "50% off",
        isActive: true,
        activationNotifiedAt: null,
        startsAt: new Date(Date.now() - 1000),
        endsAt: null,
        ...overrides
      };
      offers.push(offer);
      return offer;
    },
    seedCustomer(): FakeUser {
      const user: FakeUser = { id: randomUUID(), role: "CUSTOMER", isActive: true };
      users.push(user);
      return user;
    }
  };
}

function createFakeConfig(overrides: Record<string, unknown> = {}) {
  return { get: (key: string, fallback?: unknown) => overrides[key] ?? fallback } as any;
}

function createFakeRealtime() {
  const emitted: { userId: string; event: string; payload: unknown }[] = [];
  return { emitted, emitToUser: (userId: string, event: string, payload: unknown) => emitted.push({ userId, event, payload }) };
}

test("an offer already inside its active window is announced to every customer exactly once", async () => {
  const { prisma, seedOffer, seedCustomer, notifications } = createFakePrisma();
  const offer = seedOffer({ title: "Weekend deal" });
  seedCustomer();
  seedCustomer();
  const realtime = createFakeRealtime();
  const service = new OfferActivationNotifierService(prisma as never, createFakeConfig(), realtime as never);

  await service.processOnce();
  assert.equal(notifications.length, 2);
  assert.ok(notifications.every((notification) => notification.type === "OFFER_ACTIVE"));
  assert.ok(notifications.every((notification) => notification.body.includes("Weekend deal")));
  assert.equal(realtime.emitted.length, 2);

  await service.processOnce();
  assert.equal(notifications.length, 2, "a second poll must not re-announce the same offer");
  assert.ok(offer.activationNotifiedAt);
});

test("a scheduled offer whose start time has not arrived yet is left alone", async () => {
  const { prisma, seedOffer, seedCustomer, notifications } = createFakePrisma();
  seedOffer({ startsAt: new Date(Date.now() + 60_000) });
  seedCustomer();
  const service = new OfferActivationNotifierService(prisma as never, createFakeConfig(), createFakeRealtime() as never);

  await service.processOnce();
  assert.equal(notifications.length, 0);
});

test("an inactive or already-ended offer is never announced", async () => {
  const { prisma, seedOffer, seedCustomer, notifications } = createFakePrisma();
  seedOffer({ isActive: false });
  seedOffer({ endsAt: new Date(Date.now() - 1000) });
  seedCustomer();
  const service = new OfferActivationNotifierService(prisma as never, createFakeConfig(), createFakeRealtime() as never);

  await service.processOnce();
  assert.equal(notifications.length, 0);
});

test("an offer already marked as notified (e.g. by the ship-time backfill) is skipped", async () => {
  const { prisma, seedOffer, seedCustomer, notifications } = createFakePrisma();
  seedOffer({ activationNotifiedAt: new Date() });
  seedCustomer();
  const service = new OfferActivationNotifierService(prisma as never, createFakeConfig(), createFakeRealtime() as never);

  await service.processOnce();
  assert.equal(notifications.length, 0);
});
