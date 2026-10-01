# LUNA 自托管版

Node.js 同域服务负责游客与账号会话、水晶余额、每日领取、抽牌结算、完整阅读、笔记、日历和 AI 代理。浏览器只负责抽牌界面与展示。服务端使用 SQLite（WAL）和事务，同一阅读 ID 重试不会重复扣费；每日一牌与掉落由服务端判定。卡牌数据由 `minor.js` / `data.js` 生成 `server/card-catalog.json`，避免 AI 接受浏览器伪造的牌义。

## 本地运行

需要 Node.js 24.15+；不需要安装 npm 依赖。

```sh
cd /path/to/Mochimo-mo.github.io
npm --prefix server test
PUBLIC_ORIGIN=http://localhost:3000 ZHIPU_API_KEY='你的智谱密钥' npm --prefix server start
```

打开 `http://localhost:3000/`。数据库默认在 `server/data/luna.sqlite`（已忽略提交），服务默认监听 `127.0.0.1:3000`。不设置 `ZHIPU_API_KEY` 时抽牌仍可用，默认 AI 会明确提示尚未配置。请勿把密钥写入仓库、前端或导出的 JSON。

## VPS 部署

1. 将域名指向 VPS，开放 80/443，安装 Node.js 24.15+ 与 Caddy。把仓库置于 `/opt/luna`，以无特权用户 `luna` 运行。
2. 创建权限为 `0700` 的 `/var/lib/luna`，授予 `luna` 用户读写权限；创建权限为 `0600` 的 `/etc/luna/luna.env`：

   ```env
   PUBLIC_ORIGIN=https://tarot.example.com
   LUNA_DB_PATH=/var/lib/luna/luna.sqlite
   HOST=127.0.0.1
   PORT=3000
   ZHIPU_API_KEY=在服务器中填入密钥
   ```

3. 将 `server/luna.service.example` 安装为 `/etc/systemd/system/luna.service`，按实际 Node 路径调整 `ExecStart`。执行 `sudo systemctl daemon-reload && sudo systemctl enable --now luna`。
4. 将 `server/Caddyfile.example` 的域名改为自己的，安装到 `/etc/caddy/Caddyfile`，验证并重载 Caddy。只把 Caddy 的 80/443 暴露到公网，Node 保持监听本机。`PUBLIC_ORIGIN` 必须与浏览器地址的协议、主机名和端口一致，生产环境必须使用 HTTPS。
5. 打开 `https://你的域名/api/bootstrap`，应返回游客会话、1 颗水晶及 `Set-Cookie`。随后在网页依次验证：游客抽牌、每日一牌、用尽后注册、笔记、AI、日历、退出和重新登录。`journalctl -u luna -f` 查看服务日志。

服务端默认 AI 走同域 `/api/ai`，智谱密钥留在服务器；GitHub Pages 静态版仍使用原 Cloudflare Worker。新服务器域名无需修改 Worker 的 `SITE_ORIGIN`。自定义 AI 仍由用户浏览器直连其自行配置的接口。

## 数据迁移与备份

- 在 GitHub Pages 的“我的记录”点击“导出记录 JSON”，在服务器版注册或登录后点击“从旧站点导入 JSON”。若旧浏览器数据与服务器同域，也可用“导入此设备旧记录”。重复导入同一 ID 会跳过；旧记录只用于历史回看，不触发水晶结算。
- 同一个服务器上的游客记录会在注册时直接保留；登录已有账号会合并游客阅读，但保持原账号的水晶余额。游客识别依赖 HttpOnly Cookie；换设备或清除 Cookie 后，未注册的游客记录无法找回。
- 若沿用早期账号原型的 SQLite 文件，启动时自动复制旧 `users` 账号与余额；旧会话不会迁移，需要重新登录。旧原型的阅读本来只存在各设备浏览器，使用上面的 JSON 导出/导入迁移。
- `/var/lib/luna/luna.sqlite` 包含账号邮箱、密码哈希、用户问题和笔记，应限制文件权限并定期备份。在线备份必须使用 SQLite 备份机制；直接复制数据库文件前先停止服务，确保 WAL 已收束。恢复前也先停止服务。
- 修改卡牌文字后运行 `npm --prefix server run catalog`，并运行 `npm --prefix server test`；测试会检查目录与前端数据一致。

## API 与运维边界

`GET /api/bootstrap` 建立游客会话并领取当天水晶；`POST /api/register` / `login` / `logout` 管理账号；`POST /api/readings` 完成并结算阅读；`GET /api/readings` 支持游标翻页，`GET /api/readings/:id` 读单条，`PATCH /api/readings/:id` 更新笔记或 AI 对话，`GET /api/calendar?month=YYYY-MM` 读每日一牌，`POST /api/import` 导入旧记录，`POST /api/ai` 代理智谱流式回答。写请求要求与 `PUBLIC_ORIGIN` 相同的 `Origin`，会话 Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下启用 Secure；密码使用随机盐 scrypt。有限的进程内限流限制注册、登录、导入与 AI 调用。

当前尚未提供邮箱验证和密码找回。公开推广前应补齐邮件流程、监控与持久化的限流；清除 Cookie 仍可生成新的游客身份，游客赠礼不能作为严格防刷手段。上线前自行审阅隐私说明、数据保留与删除账号的产品流程。
