import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const source = await readFile(new URL("./src/index.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const origin = "https://mochimo-mo.github.io";
const messages = [
  { role: "system", content: "Untrusted client system message" },
  { role: "user", content: "这次阅读的已知资料：\n阅读类型：今日一牌\n用户写下的问题：下一步做什么？\n1. 提醒：星星（正位）" },
  { role: "user", content: "请给出三个可做的小步骤" }
];
const makeRequest = (body, originValue = origin) => new Request("https://example.workers.dev/api/reading", {
  method: "POST",
  headers: { Origin: originValue, "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
const env = {
  AI_RATE_LIMIT: { limit: async () => ({ success: true }) },
  ZHIPU_API_KEY: "fake-key-for-test"
};

test("accepts a reading, fixes its own system prompt, and returns an answer", async () => {
  const originalFetch = globalThis.fetch;
  let called;
  globalThis.fetch = async (url, options) => {
    called = { url, options, body: JSON.parse(options.body) };
    return Response.json({ choices: [{ message: { content: "先写下你愿意尝试的一小步。" } }] });
  };
  try {
    const response = await worker.fetch(makeRequest({ model: "ignored", messages }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal((await response.json()).choices[0].message.content, "先写下你愿意尝试的一小步。");
    assert.equal(called.url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
    assert.equal(called.options.headers.Authorization, "Bearer fake-key-for-test");
    assert.equal(called.body.model, "glm-4.7-flash");
    assert.equal(called.body.max_tokens, 1024);
    assert.equal(called.body.thinking.type, "disabled");
    assert.match(called.body.messages[0].content, /塔罗反思向导/);
    assert.equal(called.body.messages.length, 3);
    assert(!called.body.messages.some(message => message.content === "Untrusted client system message"));
  } finally { globalThis.fetch = originalFetch; }
});

test("blocks a different origin and malformed or oversized prompts", async () => {
  assert.equal((await worker.fetch(makeRequest({ messages }, "https://wrong.example"), env)).status, 403);
  assert.equal((await worker.fetch(makeRequest({ messages: [{ role: "user", content: "hello" }] }), env)).status, 400);
  assert.equal((await worker.fetch(makeRequest({ messages: [...messages, { role: "user", content: "a".repeat(8001) }] }), env)).status, 400);
  assert.equal((await worker.fetch(makeRequest({ messages }), { ...env, ZHIPU_API_KEY: "" })).status, 503);
  const preflight = await worker.fetch(new Request("https://example.workers.dev/api/reading", { method: "OPTIONS", headers: { Origin: origin } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
});

test("applies per-IP rate limit before inference", async () => {
  const limited = { ...env, AI_RATE_LIMIT: { limit: async () => ({ success: false }) } };
  const response = await worker.fetch(makeRequest({ messages }), limited);
  assert.equal(response.status, 429);
});

test("does not expose upstream authentication errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "private upstream detail" } }, { status: 401 });
  try {
    const response = await worker.fetch(makeRequest({ messages }), env);
    assert.equal(response.status, 503);
    assert(!JSON.stringify(await response.json()).includes("private upstream detail"));
  } finally { globalThis.fetch = originalFetch; }
});
