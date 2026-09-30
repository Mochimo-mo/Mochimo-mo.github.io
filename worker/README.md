# LUNA 智谱默认解读服务

这个 Cloudflare Worker 代网站调用智谱 `glm-4.7-flash`。站长的 `ZHIPU_API_KEY` 作为 Cloudflare Secret 保存；公开的 GitHub Pages 网页和访客请求都不包含它。Worker 和网页需要分别部署，网页接入 Worker URL 后才能为访客提供默认 AI 解读。

## 通过 GitHub 部署 Worker

1. 在 Cloudflare Workers & Pages 创建名为 `luna-tarot-ai` 的 Worker。
2. 在该 Worker 的 Settings → Variables and Secrets 中添加类型为 Secret、名称为 `ZHIPU_API_KEY` 的运行时密钥。不要把 Key 放进 GitHub、构建变量、网页代码或聊天记录。
3. 在 Settings → Builds 中连接 `Mochimo-mo/Mochimo-mo.github.io`，生产分支选 `master`，Root directory 填 `worker`，Build command 留空，Deploy command 使用 `npx wrangler deploy`。如果连接时没有 Root directory，完成连接后在 Build configuration 中设置它，再重试构建。
4. 将新提交推送到 `master` 触发构建，在 Deployments / Build History 确认成功，记下 `https://luna-tarot-ai.<账户子域>.workers.dev`。
5. 将网页默认 AI 请求改为 `<Worker URL>/api/reading`，再发布网页。Worker 的 Secret 不会被传给浏览器。

也可以在本目录通过 Wrangler 手动部署：`npx wrangler login`、`npx wrangler secret put ZHIPU_API_KEY`、`npx wrangler deploy`。Wrangler 需 4.36.0 或更新版本。

请求为 `POST /api/reading`，JSON 包含网站现有的 `messages` 数组。Worker 忽略浏览器发送的模型和系统提示词，验证阅读上下文，加入自己的系统提示词，然后转发给智谱。它只允许 `https://mochimo-mo.github.io` 的浏览器跨域请求，并按来源 IP 每分钟限制 4 次。Origin 头可被非浏览器客户端伪造，IP 也可能由多人共享；上线后应监测用量，并视访问量增加更严格的额度保护。

本目录可运行 `node --test test.mjs`，用模拟的智谱响应检查鉴权、牌面上下文、跨域和限流逻辑。真实 Key 的调用须在 Secret 配置完成后验证。
