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

function streamAiAnswer(upstream) {
  const reader = upstream.body.getReader();
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = value => {
        if (!cancelled) controller.enqueue(encoder.encode("data: " + JSON.stringify(value) + "\n\n"));
      };
      void (async () => {
        const decoder = new TextDecoder();
        let pending = "";
        let answer = "";
        let finished = false;
        let hidingThought = false;
        let tagPending = "";
        const visibleContent = part => {
          let text = tagPending + part;
          let visible = "";
          tagPending = "";
          while (text) {
            if (hidingThought) {
              const end = text.indexOf("</think>");
              if (end < 0) {
                tagPending = text.slice(-7);
                return visible;
              }
              text = text.slice(end + 8);
              hidingThought = false;
            } else {
              const start = text.indexOf("<think>");
              if (start >= 0) {
                visible += text.slice(0, start);
                text = text.slice(start + 7);
                hidingThought = true;
              } else {
                const tag = "<think>";
                let suffix = 0;
                for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
                  if (text.endsWith(tag.slice(0, n))) { suffix = n; break; }
                }
                visible += text.slice(0, text.length - suffix);
                tagPending = text.slice(text.length - suffix);
                return visible;
              }
            }
          }
          return visible;
        };
        const acceptEvent = event => {
          const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart()).join("\n");
          if (!data) return;
          if (data === "[DONE]") { finished = true; return; }
          let packet;
          try { packet = JSON.parse(data); } catch { return; }
          if (packet?.error) throw new Error("upstream stream error");
          const choice = packet?.choices?.[0];
          if (typeof choice?.delta?.content === "string") {
            const visible = visibleContent(choice.delta.content);
            const piece = visible.slice(0, Math.max(0, 12000 - answer.length));
            if (piece) {
              answer += piece;
              send({ delta: piece });
            }
          }
          if (choice?.finish_reason) finished = true;
        };
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            if (pending.length > 250000) throw new Error("oversized stream");
            let match;
            while ((match = /\r?\n\r?\n/.exec(pending))) {
              acceptEvent(pending.slice(0, match.index));
              pending = pending.slice(match.index + match[0].length);
            }
          }
          pending += decoder.decode();
          if (pending.trim()) acceptEvent(pending);
          if (finished && answer.trim()) send({ done: true });
          else send({ error: "AI 回复未完成，请稍后重试。" });
        } catch {
          if (!cancelled) send({ error: "智谱模型连接中断，请稍后重试。" });
        } finally {
          reader.releaseLock();
          if (!cancelled) controller.close();
        }
      })();
    },
    cancel() {
      cancelled = true;
      return reader.cancel();
    }
  });
  return new Response(body, {
    headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "X-Content-Type-Options": "nosniff" }
  });
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
    const wantsStream = request.headers.get("Accept")?.includes("text/event-stream") === true;
    try {
      const response = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ZHIPU_API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages, thinking: { type: "disabled" }, max_tokens: 1024, temperature: 0.6, stream: wantsStream }),
        signal: AbortSignal.timeout(55000)
      });
      if (!response.ok) {
        if (response.status === 429) return json({ error: "智谱当前限流或免费额度已用完，请稍后重试。" }, 429);
        if (response.status === 401 || response.status === 403) return json({ error: "本站的智谱服务密钥暂不可用。" }, 503);
        return json({ error: "智谱模型暂不可用，请稍后重试。" }, 503);
      }
      if (wantsStream) {
        if (!response.body) return json({ error: "智谱模型暂不可用，请稍后重试。" }, 503);
        return streamAiAnswer(response);
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
