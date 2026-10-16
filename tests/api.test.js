import test from "node:test";
import assert from "node:assert/strict";
import { aliceResponse, fitAliceText, isSearchIntent, safeHistory } from "../api/index.js";

test("Alice response uses required response envelope", () => {
  const result = aliceResponse("Привет", false, [{ role: "user", text: "тест" }]);
  assert.equal(result.version, "1.0");
  assert.equal(result.response.text, "Привет");
  assert.equal(result.response.end_session, false);
  assert.deepEqual(result.session_state.history, [{ role: "user", text: "тест" }]);
});

test("search intent detects Russian and English freshness requests", () => {
  assert.equal(isSearchIntent("Какая погода сегодня?"), true);
  assert.equal(isSearchIntent("What is the latest news?"), true);
  assert.equal(isSearchIntent("Расскажи сказку"), false);
});

test("long responses are cut at a natural boundary and stay within Alice limit", () => {
  const value = fitAliceText(("Это короткое предложение. ").repeat(100));
  assert.ok(value.length <= 1024);
  assert.ok(value.endsWith("."));
});

test("history filters malformed messages and keeps last 8", () => {
  const input = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "model" : "user", text: String(i) }));
  input.push({ role: "hacker", text: "ignore" }, { role: "user", text: 17 });
  const result = safeHistory(input);
  assert.equal(result.length, 8);
  assert.equal(result[0].text, "4");
  assert.equal(result[7].text, "11");
});

function mockResponse() {
  let statusCode = 200;
  let payload;
  return {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return value; },
    setHeader() {},
    get statusCode() { return statusCode; },
    get payload() { return payload; }
  };
}

test("GET health check returns an ok response", async () => {
  process.env.WEBHOOK_SECRET = "test-secret";
  const handler = (await import("../api/index.js")).default;
  const res = mockResponse();
  await handler({ method: "GET", query: { token: "test-secret" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.service, "alice-aitunnel-serper");
});

test("requests without the webhook token are rejected", async () => {
  process.env.WEBHOOK_SECRET = "test-secret";
  const handler = (await import("../api/index.js")).default;
  const missing = mockResponse();
  const wrong = mockResponse();
  await handler({ method: "POST", query: {}, body: { request: { command: "привет" } } }, missing);
  await handler({ method: "GET", url: "/api?token=other-secret" }, wrong);
  assert.equal(missing.statusCode, 401);
  assert.equal(wrong.statusCode, 401);
});

test("launch request returns a valid Alice greeting without external API keys", async () => {
  process.env.WEBHOOK_SECRET = "test-secret";
  const handler = (await import("../api/index.js")).default;
  const res = mockResponse();
  await handler({
    method: "POST",
    url: "/api?token=test-secret",
    body: { request: { command: "" }, state: { session: { history: [] } } }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.version, "1.0");
  assert.match(res.payload.response.text, /Привет/);
  assert.equal(res.payload.response.end_session, false);
});
