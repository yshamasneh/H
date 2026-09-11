import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

/**
 * All-in-one repeatable ramp for JOVO MARKET: the customer flow ramping 10 -> 50 -> 100 -> 250
 * concurrent VUs, plus a light constant load on the admin order list and the driver
 * active-delivery fetch running throughout.
 *
 *   ./.bin/k6.exe run mixed-ramp.js
 *
 * Env: BASE_URL (default http://localhost:3000/api/v1). Local/dev only — never production.
 */

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000/api/v1";

const PRODUCT_IDS = [
  "00000000-0000-4000-8000-000000000111",
  "00000000-0000-4000-8000-000000000112",
  "00000000-0000-4000-8000-000000000121",
  "00000000-0000-4000-8000-000000000122",
  "00000000-0000-4000-8000-000000000131"
];

const customerErrors = new Rate("customer_errors");
const adminErrors = new Rate("admin_errors");
const driverErrors = new Rate("driver_errors");
const ordersPlaced = new Counter("orders_placed");
const orderTrend = new Trend("step_place_order", true);
const adminOrdersTrend = new Trend("admin_orders_list", true);
const driverDeliveriesTrend = new Trend("driver_active_deliveries", true);

export const options = {
  scenarios: {
    customer: {
      executor: "ramping-vus",
      exec: "customerFlow",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 10 },
        { duration: "30s", target: 10 },
        { duration: "15s", target: 50 },
        { duration: "30s", target: 50 },
        { duration: "15s", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "15s", target: 250 },
        { duration: "30s", target: 250 },
        { duration: "10s", target: 0 }
      ],
      gracefulRampDown: "10s"
    },
    admin_reads: {
      executor: "constant-vus",
      exec: "adminReads",
      vus: 3,
      duration: "3m30s"
    },
    driver_reads: {
      executor: "constant-vus",
      exec: "driverReads",
      vus: 3,
      duration: "3m30s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{step:order}": ["p(95)<2000"],
    customer_errors: ["rate<0.02"]
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"]
};

function randomUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loginAs(phoneNumber) {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ countryCode: "+970", phoneNumber, password: "Test@12345" }),
    { headers: { "Content-Type": "application/json" }, tags: { step: "login" } }
  );
  return res.status === 200 || res.status === 201 ? res.json("accessToken") : null;
}

// setup() logs in the customer, admin and driver accounts once. Sharing one session per role is
// deliberate: login is (correctly) throttled to 10/min/IP, so a single-IP generator must not put
// login on the per-request hot path — a real client also logs in once, then reuses the session.
export function setup() {
  return {
    customerToken: loginAs("590000000"),
    adminToken: loginAs("590000001"),
    driverToken: loginAs("590000003")
  };
}

export function customerFlow(data) {
  const customerToken = data.customerToken;
  if (!customerToken) {
    customerErrors.add(true);
    sleep(0.5);
    return;
  }
  const h = { headers: { Authorization: `Bearer ${customerToken}`, "Content-Type": "application/json" } };

  const list = http.get(`${BASE_URL}/supermarkets?page=1&pageSize=20`, { ...h, tags: { step: "browse" } });
  const supermarketId = list.status === 200 ? list.json("items.0.id") : null;
  if (!supermarketId) {
    customerErrors.add(true);
    return;
  }
  const cat = http.get(`${BASE_URL}/supermarkets/${supermarketId}/catalog?page=1&pageSize=50`, { ...h, tags: { step: "catalog" } });
  const productId = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
  const body = {
    restaurantId: supermarketId,
    items: [{ menuItemId: productId, quantity: 1 + Math.floor(Math.random() * 2) }],
    deliveryLabel: "Home",
    deliveryAddressLine: "Rukab Street, Ramallah",
    deliveryLatitude: 31.9019,
    deliveryLongitude: 35.2042,
    paymentMethod: "CASH"
  };
  const quote = http.post(`${BASE_URL}/orders/quote`, JSON.stringify(body), { ...h, tags: { step: "quote" } });
  const order = http.post(`${BASE_URL}/orders`, JSON.stringify({ ...body, idempotencyKey: randomUUID() }), { ...h, tags: { step: "order" } });
  orderTrend.add(order.timings.duration);
  const ok = check(cat, { "catalog ok": (r) => r.status === 200 }) &&
    check(quote, { "quote ok": (r) => r.status === 200 || r.status === 201 }) &&
    check(order, { "order 201": (r) => r.status === 201 });
  customerErrors.add(!ok);
  if (order.status === 201) ordersPlaced.add(1);
}

export function adminReads(data) {
  if (!data.adminToken) {
    adminErrors.add(true);
    return;
  }
  const res = http.get(`${BASE_URL}/admin/orders?page=1`, {
    headers: { Authorization: `Bearer ${data.adminToken}` },
    tags: { step: "admin_orders" }
  });
  adminOrdersTrend.add(res.timings.duration);
  adminErrors.add(!check(res, { "admin orders 200": (r) => r.status === 200 }));
  sleep(0.5);
}

export function driverReads(data) {
  if (!data.driverToken) {
    driverErrors.add(true);
    return;
  }
  const res = http.get(`${BASE_URL}/driver/me/deliveries`, {
    headers: { Authorization: `Bearer ${data.driverToken}` },
    tags: { step: "driver_deliveries" }
  });
  driverDeliveriesTrend.add(res.timings.duration);
  const avail = http.get(`${BASE_URL}/driver/me/deliveries/available`, {
    headers: { Authorization: `Bearer ${data.driverToken}` },
    tags: { step: "driver_available" }
  });
  driverErrors.add(!check(res, { "driver deliveries 200": (r) => r.status === 200 }) ||
    !check(avail, { "driver available 200": (r) => r.status === 200 }));
  sleep(0.5);
}
