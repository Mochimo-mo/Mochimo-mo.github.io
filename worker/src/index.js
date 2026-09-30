// Zhipu GLM bridge for the public LUNA site.
// ZHIPU_API_KEY is a Cloudflare secret, never sent to browsers.
const SITE_ORIGIN = "https://mochimo-mo.github.io";
const MODEL = "glm-4.7-flash";
const UPSTREAM = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
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
  if (total > 16000 || !messages[0].content.startsWith("这次阅读的已知资料：\n阅读类型：")) return null;
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
    if (!env.ZHIPU_API_KEY) return json({ error: "本站 AI 尚未配置完成。" }, 503);
    try {
      const response = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ZHIPU_API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: 2048, temperature: 0.6, stream: false }),
        signal: AbortSignal.timeout(55000)
      });
      if (!response.ok) {
        if (response.status === 429) return json({ error: "智谱当前限流或免费额度已用完，请稍后重试。" }, 429);
        if (response.status === 401 || response.status === 403) return json({ error: "本站的智谱服务密钥暂不可用。" }, 503);
        return json({ error: "智谱模型暂不可用，请稍后重试。" }, 503);
      }
      const result = await response.json();
      const content = result?.choices?.[0]?.message?.content;
      const answer = typeof content === "string" ? content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : "";
      if (!answer) return json({ error: "AI 暂时没有回答，请稍后重试。" }, 503);
      return json({ choices: [{ message: { role: "assistant", content: answer } }] });
    } catch {
      return json({ error: "智谱模型连接超时或暂不可用，请稍后重试。" }, 503);
    }
  }
};
