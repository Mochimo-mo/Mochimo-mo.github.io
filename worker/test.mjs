import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const source = await readFile(new URL("./src/index.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const origin = "https://mochimo-mo.github.io";
const messages = [
  { role: "system", content: "Untrusted client system message" },
  { role: "user", content: "牌面：正位星星。问题：下一步做什么？" },
  { role: "user", content: "请给出三个可做的小步骤" }
];
const makeRequest = (body, originValue = origin) => new Request("https://example.workers.dev/api/reading", {
  method: "POST",
  headers: { Origin: originValue, "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
const calls = [];
const env = {
  AI_RATE_LIMIT: { limit: async () => ({ success: true }) },
  AI: { run: async (model, options) => {
    calls.push({ model, options });
    return { choices: [{ message: { content: "先写下你愿意尝试的一小步。" } }] };
  } }
};

test("accepts a reading, fixes its own system prompt, and returns an answer", async () => {
  const response = await worker.fetch(makeRequest({ messages }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal((await response.json()).choices[0].message.content, "先写下你愿意尝试的一小步。");
  assert.equal(calls.at(-1).model, "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.match(calls.at(-1).options.messages[0].content, /塔罗反思向导/);
  assert.equal(calls.at(-1).options.messages.length, 3);
});

test("blocks a different origin and malformed or oversized prompts", async () => {
  assert.equal((await worker.fetch(makeRequest({ messages }, "https://wrong.example"), env)).status, 403);
  assert.equal((await worker.fetch(makeRequest({ messages: [{ role: "user", content: "hello" }] }), env)).status, 400);
  assert.equal((await worker.fetch(makeRequest({ messages: [...messages, { role: "user", content: "a".repeat(8001) }] }), env)).status, 400);
});

test("applies per-IP rate limit before inference", async () => {
  const limited = { ...env, AI_RATE_LIMIT: { limit: async () => ({ success: false }) } };
  const before = calls.length;
  const response = await worker.fetch(makeRequest({ messages }), limited);
  assert.equal(response.status, 429);
  assert.equal(calls.length, before);
});
