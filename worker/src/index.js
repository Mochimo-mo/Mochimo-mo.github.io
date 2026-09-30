// Cloudflare Workers AI bridge for the public LUNA site.
// Its free allocation is capped by Cloudflare; no model key goes to the browser.
const SITE_ORIGIN = "https://mochimo-mo.github.io";
const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const SYSTEM_PROMPT = "你是 LUNA 的中文塔罗反思向导。依据用户提供的真实问题、牌位、牌义与正逆位解读，不编造牌或生活事实。塔罗只用于整理思绪，不作确定的未来预言。先回应具体问题，再解释牌面线索，最后给出可选择的小步骤。若没有填写问题，请邀请补充。不要输出思考过程或标签。通常回答 250 到 450 字；重大医疗、法律、财务或安全决定需提醒核对事实并寻求专业帮助。";

const cors = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Vary: "Origin"
};
const json = (data, status = 200) => Response.json(data, { status, headers: cors });

function validMessages(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 16) return null;
  const messages = input.filter(item => item?.role !== "system");
  if (!messages.length || messages[0].role !== "user" || messages.at(-1).role !== "user") return null;
  let total = 0;
  for (const message of messages) {
    if ((message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" || !message.content.trim() || message.content.length > 8000) return null;
    total += message.content.length;
  }
  if (total > 16000) return null;
  return [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/reading") return json({ error: "Not found" }, 404);
    // Browser CORS is not authentication, but disallows other pages by default.
    if (request.headers.get("Origin") !== SITE_ORIGIN) return json({ error: "Forbidden" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON required" }, 415);
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.AI_RATE_LIMIT.limit({ key: clientIp });
    if (!success) return json({ error: "稍等片刻，再继续追问。" }, 429);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 20000) return json({ error: "问题太长，请缩短后再试。" }, 413);
      body = JSON.parse(raw);
    } catch { return json({ error: "无效的请求。" }, 400); }
    const messages = validMessages(body?.messages);
    if (!messages) return json({ error: "请先完成抽牌，再提出简短的问题。" }, 400);
    try {
      const result = await env.AI.run(MODEL, { messages, max_tokens: 800, temperature: 0.6 });
      const answer = result?.response || result?.choices?.[0]?.message?.content;
      if (typeof answer !== "string" || !answer.trim()) return json({ error: "AI 暂时没有回答，请稍后重试。" }, 503);
      return json({ choices: [{ message: { role: "assistant", content: answer.trim() } }] });
    } catch {
      return json({ error: "免费 AI 额度或服务暂时不可用，请稍后重试。" }, 503);
    }
  }
};
