# LUNA 自托管账号服务

这是与网页同域运行的 Node.js 服务。游客可继续在浏览器本地使用；余额用尽后出现注册引导。邮箱和密码注册赠送 **2 颗**水晶，赠礼每个账号只发一次。账号的余额、每日领取、占卜扣费及随机掉落由 SQLite 事务处理；重复提交同一阅读 ID 不会重复扣费。账号阅读和笔记暂存在本机浏览器，尚未跨设备同步。

## 本地试运行

要求 Node.js 24.15+。不需要 npm 安装依赖。

```sh
cd /path/to/Mochimo-mo.github.io
npm --prefix server test
PUBLIC_ORIGIN=http://localhost:3000 npm --prefix server start
```

浏览器打开 `http://localhost:3000/`。本地 SQLite 默认在 `server/data/luna.sqlite`，已加入 `.gitignore`。服务默认只监听 `127.0.0.1:3000`。

## VPS 部署

1. 准备指向 VPS 的域名 DNS 记录，开放 80/443 端口，安装 Node.js 24.15+ 和 Caddy。把本仓库放在 `/opt/luna`，为服务创建无特权用户 `luna`。
2. 创建持久目录 `/var/lib/luna` 并赋予 `luna` 读写权限。创建 `/etc/luna/luna.env`，内容如下（域名换成自己的）：

   ```env
   PUBLIC_ORIGIN=https://tarot.example.com
   LUNA_DB_PATH=/var/lib/luna/luna.sqlite
   HOST=127.0.0.1
   PORT=3000
   ```

3. 将 `server/luna.service.example` 安装成 `/etc/systemd/system/luna.service`。如果 Node 的路径不是 `/usr/bin/node`，修改 `ExecStart`。执行 `sudo systemctl daemon-reload && sudo systemctl enable --now luna`。
4. 将 `server/Caddyfile.example` 中的域名换成自己的，放入 `/etc/caddy/Caddyfile`，验证配置后重载 Caddy。Caddy 对有正常 DNS 的域名自动申请 HTTPS 证书。公网只开放 Caddy 的 80/443，不要把 Node 的 3000 端口公开。
5. 先用浏览器打开 `https://你的域名/api/session`，应看到 `{"authenticated":false,...}`；再在网页上测试注册、退出、登录与水晶余额。服务端日志用 `journalctl -u luna -f` 查看。
6. 智谱 AI 仍由 `worker/` 中的 Cloudflare Worker 提供。把新站点的完整来源（例如 `https://tarot.example.com`）添加为 Worker 环境变量 `SITE_ORIGIN`，重新部署 Worker。GitHub Pages 原域名仍可继续使用 AI。

账号 API 只接受与 `PUBLIC_ORIGIN` 完全相同的浏览器来源；生产环境使用 HTTPS 和 `Secure; HttpOnly; SameSite=Strict` 会话 Cookie。服务器端密码采用带随机盐的 scrypt 哈希。请保护并备份 `/var/lib/luna` 数据库；在线备份需使用 SQLite 的备份机制，或停服务后再复制数据库文件。

## 当前边界

- 邮箱尚未验证，也没有邮件找回密码。公开推广前建议补上验证和找回流程，并为注册赠礼增加反滥用措施；IP 限流无法阻止多邮箱或代理注册。
- 游客水晶保存在浏览器，无法可信地迁入账号；注册会得到服务器发放的 2 颗，不累加游客余额。
- 阅读、日历和笔记仍在当前设备，登录只同步水晶。跨设备同步阅读需要后续加记录 API 和迁移流程。
- 日期以北京时间判定。服务器不应直接接受浏览器提供的余额、中奖结果或“已经注册”状态。
