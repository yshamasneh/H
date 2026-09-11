import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

// Local UUID v4 (no remote jslib import) so the script runs offline and is fully self-contained.
function randomUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Core customer flow load test for JOVO MARKET (supermarket-only launch scope).
 *
 *   login (once per VU) -> browse supermarkets -> open catalog -> quote (cart review) -> place order
 *
 * Parametrised entirely by env vars so the same script drives every ramp level and is repeatable:
 *   BASE_URL          default http://localhost:3000/api/v1
 *   VUS               fixed VUs (default 10)
 *   DURATION          test duration (default 30s)
 *   PLACE_ORDER_RATIO 0..1, fraction of iterations that actually place an order (default 1)
 *   SUMMARY_OUT       optional path to write the JSON summary to
 *   THINK_MS          per-iteration sleep in ms (default 0 — max pressure)
 *
 * Runs against local/dev only. Never point BASE_URL at production.
 */

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000/api/v1";
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || "30s";
const PLACE_ORDER_RATIO = __ENV.PLACE_ORDER_RATIO === undefined ? 1 : Number(__ENV.PLACE_ORDER_RATIO);
const THINK_MS = Number(__ENV.THINK_MS || 0);

// Seeded JOVO MARKET products (prisma/seed.ts). Spread orders across all five so the test measures
// real throughput rather than artificial single-hot-row lock contention on one product.
const PRODUCT_IDS = [
  "00000000-0000-4000-8000-000000000111", // Bananas
  "00000000-0000-4000-8000-000000000112", // Tomatoes
  "00000000-0000-4000-8000-000000000121", // Fresh Milk
  "00000000-0000-4000-8000-000000000122", // Large Eggs
  "00000000-0000-4000-8000-000000000131" // Basmati Rice
];

const loginTrend = new Trend("step_login", true);
const browseTrend = new Trend("step_browse_supermarkets", true);
const catalogTrend = new Trend("step_catalog", true);
const quoteTrend = new Trend("step_quote", true);
const orderTrend = new Trend("step_place_order", true);
const flowErrors = new Rate("flow_errors");
const ordersPlaced = new Counter("orders_placed");

export const options = {
  scenarios: {
    customer: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    flow_errors: ["rate<0.01"]
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"]
};

/**
 * Authenticate ONCE in setup() and share the session token across all VUs. This is deliberate: the
 * login route is (correctly) rate-limited to 10/min/IP as anti-brute-force, and a single-IP load
 * generator would otherwise measure that throttle instead of the app tier. A real client also logs
 * in once and then makes many requests on the same session — which is exactly what this models. The
 * login step's own latency is measured here (once) and reported separately.
 */
export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ countryCode: "+970", phoneNumber: "590000000", password: "Test@12345" }),
    { headers: { "Content-Type": "application/json" }, tags: { step: "login" } }
  );
  loginTrend.add(res.timings.duration);
  const ok = check(res, { "login ok": (r) => r.status === 200 || r.status === 201 });
  if (!ok) throw new Error(`setup login failed: HTTP ${res.status} ${res.body}`);
  return { token: res.json("accessToken") };
}

export default function (data) {
  const token = data.token;
  const authHeaders = { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };

  // 1. Browse supermarkets
  const listRes = http.get(`${BASE_URL}/supermarkets?page=1&pageSize=20`, { ...authHeaders, tags: { step: "browse" } });
  browseTrend.add(listRes.timings.duration);
  const listOk = check(listRes, { "supermarkets 200": (r) => r.status === 200 });
  flowErrors.add(!listOk);
  if (!listOk) return;
  const supermarketId = listRes.json("items.0.id");
  if (!supermarketId) {
    flowErrors.add(true);
    return;
  }

  // 2. Open catalog
  const catRes = http.get(`${BASE_URL}/supermarkets/${supermarketId}/catalog?page=1&pageSize=50`, {
    ...authHeaders,
    tags: { step: "catalog" }
  });
  catalogTrend.add(catRes.timings.duration);
  const catOk = check(catRes, { "catalog 200": (r) => r.status === 200 });
  flowErrors.add(!catOk);
  if (!catOk) return;

  // 3. Build a small cart (1-2 line items across random products) and quote it (cart review)
  const productId = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
  const items = [{ menuItemId: productId, quantity: 1 + Math.floor(Math.random() * 2) }];
  const orderBody = {
    restaurantId: supermarketId,
    items,
    deliveryLabel: "Home",
    deliveryAddressLine: "Rukab Street, Ramallah",
    deliveryLatitude: 31.9019,
    deliveryLongitude: 35.2042,
    paymentMethod: "CASH"
  };
  const quoteRes = http.post(`${BASE_URL}/orders/quote`, JSON.stringify(orderBody), {
    ...authHeaders,
    tags: { step: "quote" }
  });
  quoteTrend.add(quoteRes.timings.duration);
  const quoteOk = check(quoteRes, { "quote ok": (r) => r.status === 200 || r.status === 201 });
  flowErrors.add(!quoteOk);
  if (!quoteOk) return;

  // 4. Place order (idempotency key per checkout), for the configured fraction of iterations
  if (Math.random() < PLACE_ORDER_RATIO) {
    const placeBody = { ...orderBody, idempotencyKey: randomUUID() };
    const orderRes = http.post(`${BASE_URL}/orders`, JSON.stringify(placeBody), {
      ...authHeaders,
      tags: { step: "order" }
    });
    orderTrend.add(orderRes.timings.duration);
    const orderOk = check(orderRes, { "order 201": (r) => r.status === 201 });
    flowErrors.add(!orderOk);
    if (orderOk) ordersPlaced.add(1);
  }

  if (THINK_MS > 0) sleep(THINK_MS / 1000);
}

export function handleSummary(data) {
  const out = {};
  const stdout = textSummary(data);
  out["stdout"] = stdout;
  if (__ENV.SUMMARY_OUT) {
    out[__ENV.SUMMARY_OUT] = JSON.stringify(data, null, 2);
  }
  return out;
}

// Minimal text summary (avoids importing the full k6 summary lib for portability across versions).
function textSummary(data) {
  const m = data.metrics;
  const line = (label, v) => `${label.padEnd(28)} ${v}`;
  const dur = m.http_req_duration ? m.http_req_duration.values : {};
  const rps = m.http_reqs ? m.http_reqs.values.rate : 0;
  const failed = m.http_req_failed ? m.http_req_failed.values.rate : 0;
  const orders = m.orders_placed ? m.orders_placed.values.count : 0;
  const step = (name) => {
    const s = m[name];
    if (!s) return `${name}: n/a`;
    return `${name.padEnd(26)} avg=${fmt(s.values.avg)} p95=${fmt(s.values["p(95)"])} p99=${fmt(s.values["p(99)"])} max=${fmt(s.values.max)}`;
  };
  return [
    "",
    "================ JOVO customer-flow summary ================",
    line("VUs", VUS),
    line("duration", DURATION),
    line("http_reqs/s", rps.toFixed(1)),
    line("http_req_failed", (failed * 100).toFixed(2) + "%"),
    line("http_req_duration p95", fmt(dur["p(95)"])),
    line("http_req_duration p99", fmt(dur["p(99)"])),
    line("http_req_duration max", fmt(dur.max)),
    line("orders_placed", orders),
    "---- per step (ms) ----",
    step("step_login"),
    step("step_browse_supermarkets"),
    step("step_catalog"),
    step("step_quote"),
    step("step_place_order"),
    "===========================================================",
    ""
  ].join("\n");
}

function fmt(v) {
  return v === undefined ? "n/a" : `${v.toFixed(1)}ms`;
}
