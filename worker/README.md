# LUNA 免费 AI 接口

这个 Worker 使用 Cloudflare Workers AI 的 `@cf/qwen/qwen3-30b-a3b-fp8`。网站访客无需登录、无需输入 API Key；站长需有一个 Cloudflare 账户来部署 Worker。Cloudflare 免费计划按每日免费推理额度限制，额度用完后当天的请求会失败，不会自动付费。

1. 在 Cloudflare 免费账户中启用 Workers。安装 Wrangler 4.36.0 或更高版本，并在此目录运行 `npx wrangler login`。
2. 运行 `npx wrangler deploy`，记录返回的 `https://luna-tarot-ai.<subdomain>.workers.dev` 地址。
3. 把返回的 Worker URL 接入网页的默认 AI 请求，再发布网页文件。不要把其他模型服务的私钥写进网页代码。

接口仅接受来自 `https://mochimo-mo.github.io` 的 `POST /api/reading`，请求 JSON 包含 `messages` 数组。浏览器发送用户的问题、牌面和对话；Cloudflare 根据其数据处理政策提供推理。每个 IP 每分钟最多 4 次，允许共享 IP 的访客可能一起触发限制。Origin 限制不能防止伪造请求，Cloudflare 免费额度是最终预算上限。建议在 Cloudflare 控制台监测实际用量。
