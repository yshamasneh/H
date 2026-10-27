import { ApiException } from "../common/api.exception";

/**
 * Per-account protection for password login, on top of the per-IP throttle on the route.
 *
 * Two counters of recent failures, both keyed by the normalised phone whether or not an account
 * exists for it (so the behaviour reveals nothing about which numbers are registered):
 *
 *  - per phone *and* client IP: after `pairFreeFailures` failures, that IP must wait before trying
 *    that phone again, doubling each time up to `pairMaxBackoffMs`. While it waits, its attempts are
 *    refused outright, correct password included, or the backoff would protect nothing. Another IP
 *    is not affected, which is the point: someone spamming the administrator's number from their
 *    own connection cannot lock the administrator out of theirs.
 *  - per phone across all IPs: after `accountFreeFailures` failures, every attempt on that phone is
 *    answered more slowly (a server-side delay doubling up to `accountMaxDelayMs`), but it is still
 *    answered, and a correct password still signs in. A distributed guesser gets slower; the real
 *    owner is delayed by a few seconds at most and never locked out.
 *
 * Counters forget a phone `windowMs` after its last failure and are cleared by a successful login.
 * State is in this process's memory, bounded to `maxEntries` keys: the API runs as one replica
 * (docs/railway-setup.md); a restart forgets it, which only ever makes it more lenient.
 */
export type LoginAttemptLimiterOptions = {
  pairFreeFailures: number;
  pairBaseBackoffMs: number;
  pairMaxBackoffMs: number;
  accountFreeFailures: number;
  accountBaseDelayMs: number;
  accountMaxDelayMs: number;
  windowMs: number;
  maxEntries: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

type Counter = { failures: number; lastFailureAt: number; blockedUntil: number };

const defaults: LoginAttemptLimiterOptions = {
  pairFreeFailures: 5,
  pairBaseBackoffMs: 1_000,
  pairMaxBackoffMs: 15 * 60_000,
  accountFreeFailures: 10,
  accountBaseDelayMs: 250,
  accountMaxDelayMs: 4_000,
  windowMs: 15 * 60_000,
  maxEntries: 20_000,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

export class LoginAttemptLimiter {
  private readonly options: LoginAttemptLimiterOptions;
  private readonly pairs = new Map<string, Counter>();
  private readonly accounts = new Map<string, Counter>();

  constructor(options: Partial<LoginAttemptLimiterOptions> = {}) {
    this.options = { ...defaults, ...options };
  }

  /** Call before checking the password. Throws 429 while this IP is backing off for this phone. */
  async beforeAttempt(phone: string, ip: string): Promise<void> {
    const now = this.options.now();
    const pair = this.current(this.pairs, pairKey(phone, ip), now);
    if (pair && pair.blockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((pair.blockedUntil - now) / 1000));
      throw new ApiException(
        429,
        "LOGIN_TEMPORARILY_BLOCKED",
        `Too many incorrect attempts. Please wait ${retryAfterSeconds} seconds and try again.`,
        { retryAfterSeconds }
      );
    }
    const account = this.current(this.accounts, phone, now);
    const excess = (account?.failures ?? 0) - this.options.accountFreeFailures;
    if (excess >= 0) {
      await this.options.sleep(Math.min(this.options.accountBaseDelayMs * 2 ** excess, this.options.accountMaxDelayMs));
    }
  }

  recordFailure(phone: string, ip: string): void {
    const now = this.options.now();
    const pair = this.bump(this.pairs, pairKey(phone, ip), now);
    const excess = pair.failures - this.options.pairFreeFailures;
    if (excess >= 0) {
      pair.blockedUntil = now + Math.min(this.options.pairBaseBackoffMs * 2 ** excess, this.options.pairMaxBackoffMs);
    }
    this.bump(this.accounts, phone, now);
  }

  recordSuccess(phone: string, ip: string): void {
    this.pairs.delete(pairKey(phone, ip));
    this.accounts.delete(phone);
  }

  private current(map: Map<string, Counter>, key: string, now: number): Counter | undefined {
    const counter = map.get(key);
    if (counter && now - counter.lastFailureAt > this.options.windowMs && counter.blockedUntil <= now) {
      map.delete(key);
      return undefined;
    }
    return counter;
  }

  private bump(map: Map<string, Counter>, key: string, now: number): Counter {
    const counter = this.current(map, key, now) ?? { failures: 0, lastFailureAt: now, blockedUntil: 0 };
    counter.failures += 1;
    counter.lastFailureAt = now;
    // Re-insert so the Map's insertion order is least-recently-failed first, then trim from there.
    map.delete(key);
    map.set(key, counter);
    while (map.size > this.options.maxEntries) {
      map.delete(map.keys().next().value as string);
    }
    return counter;
  }
}

function pairKey(phone: string, ip: string): string {
  return `${phone}|${ip}`;
}
