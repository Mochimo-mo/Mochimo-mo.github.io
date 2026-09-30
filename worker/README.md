# LUNA 智谱默认解读服务

这个 Cloudflare Worker 代网站调用智谱 `glm-4.7-flash`。站长的 `ZHIPU_API_KEY` 作为 Cloudflare Secret 保存；公开的 GitHub Pages 网页和访客请求都不包含它。当前 Worker 只有源码，尚未部署，网页目前仍使用每台设备自行填写 Key 的方式。

## 接入步骤

1. 在 Cloudflare Workers 账户中部署本目录。Wrangler 需 4.36.0 或更新版本，在本目录运行 `npx wrangler login`。
2. 运行 `npx wrangler secret put ZHIPU_API_KEY`，按提示在本机输入自己的智谱 Key。也可部署后在 Cloudflare 控制台的 Worker 设置中添加同名 Secret。不要把 Key 放进 GitHub、网页代码或聊天记录。
3. 运行 `npx wrangler deploy`，记下 Cloudflare 返回的 Worker URL。
4. 将网页默认 AI 请求改成 `<Worker URL>/api/reading`，再发布网页。切换后站长的 Key 仅用于 Worker 向智谱发出的请求。

请求为 `POST /api/reading`，JSON 包含网站现有的 `messages` 数组。Worker 忽略浏览器发送的模型和系统提示词，验证阅读上下文，加入自己的系统提示词，然后转发给智谱。它只允许 `https://mochimo-mo.github.io` 的浏览器跨域请求，并按来源 IP 每分钟限制 4 次。Origin 头可被非浏览器客户端伪造，IP 也可能由多人共享；上线后应监测用量，并视访问量增加更严格的额度保护。

本目录可运行 `node --test test.mjs`，用模拟的智谱响应检查鉴权、牌面上下文、跨域和限流逻辑。真实 Key 的调用须在 Secret 配置完成后验证。
