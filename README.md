# Web Terminal

通过浏览器（电脑或手机）操控本机 zsh 的 Web 终端，完整复用宿主机的 `zshrc / zprofile / 环境变量 / alias`，支持：

- 多 Tab，每个 Tab 内可任意水平/垂直分屏（多终端 或 终端 + 文件树）
- 局域网访问 + Token 认证 + LAN 白名单
- 手机适配：竖屏底部虚拟修饰键栏（Esc/Tab/Ctrl+C/方向键…）+ 工具栏，横屏侧边栏，双指滑动切 Tab
- 常用目录管理：手动 Pin 书签 + 从 `~/.zsh_history` 自动统计高频 cd 目标 + 侧边文件树点击即跳
- 命令片段：保存常用命令，一键执行或注入

技术栈：**Node.js + Fastify + node-pty + ws + React + Vite + xterm.js v5**。

## 快速开始

依赖：

- Node 20+（已在 20.19 验证）
- pnpm 10+
- macOS 或 Linux 的 zsh（Windows 走 ConPTY 但 zshrc 复用逻辑不适用）

```bash
pnpm install
pnpm dev
```

启动后控制台会打印：

```
Local:    http://127.0.0.1:7681/
Network:  http://192.168.x.x:7681/
Token:    abc12345…ef01
Open:     http://192.168.x.x:7681/?token=abc...
```

并显示一张终端 ASCII 二维码 — 手机扫码即可打开（同 WiFi 局域网）。

> 开发模式下前端跑在 5173，由 vite 代理 `/api`、`/ws`、`/qr` 到 7681。生产构建后由后端直接 serve `dist/`。

构建生产版本：

```bash
pnpm build
pnpm start          # 默认 0.0.0.0:7681
pnpm start --port 8080 --host 127.0.0.1 --no-token
```

## CLI 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--host <ip>` | `0.0.0.0` | 绑定地址。设为 `127.0.0.1` 仅本机可访问 |
| `--port <n>` | `7681` | HTTP/WS 端口 |
| `--no-token` | 关 | **危险**：禁用 token 认证（仅在 `--host 127.0.0.1` 时使用） |
| `--data-dir <path>` | `~/.web_terminal` | 数据目录（书签 / 片段 / token / zsh wrapper） |
| `--allow-root <p1:p2:..>` | `$HOME:/tmp:/Users:/Volumes` | 文件树允许的根目录（冒号分隔） |
| `--static-dir <path>` | 自动 | 自定义前端静态文件目录 |

## 安全模型

1. **LAN 白名单** —— 仅允许 `127.0.0.1`、`10/8`、`192.168/16`、`172.16/12`、IPv6 ULA/link-local。其他来源直接 403。
2. **Token 认证** —— 启动时随机生成 32 字节十六进制 token，写入 `~/.web_terminal/token`（mode 600）。所有 REST 请求必须携带 `Authorization: Bearer <token>`，WS 通过 `?token=<token>` 查询参数；前端首次拿到 token 后存入 `sessionStorage` 并清掉 URL。
3. **文件 API** —— 所有 path 经 `realpath` 后必须落入 `--allow-root` 允许的子树，否则 403。
4. **生产部署建议** —— 若需要公网访问，请套上 HTTPS 反向代理（Caddy / nginx），并把后端绑定 `127.0.0.1`。本服务自身不提供 HTTPS。

## 工作原理速览

- **复用 zshrc / 环境变量**：服务启动时在 `~/.web_terminal/zsh-init/` 写入一组 wrapper（`.zshenv` / `.zprofile` / `.zshrc` / `.zlogin`），这些 wrapper 会先 source 用户原始的同名文件再注入一个 `precmd` 钩子。spawn 时设置 `ZDOTDIR` 指向这个目录、`WEBTERM_USER_HOME` / `WEBTERM_USER_ZDOTDIR` 保存原始位置。这样既不污染用户配置，又能拿到完整环境。
- **CWD 跟踪**：注入的 hook 在每次 prompt 之前发送 OSC `\e]1337;CurrentDir=<path>\a`（iTerm2 私有序列）。后端流式解析 PTY 输出，把 cwd 推送到前端，文件树/书签/标题随之更新。这种 OSC 序列被 xterm.js 默认忽略，不影响渲染。
- **断线复活**：WS 断开后服务保留 PTY 30 秒，期间用同一 `sessionId` 重连可恢复（vim 等长程序不会丢状态）；超过 30s 才 kill。

## 故障排查

- **`posix_spawnp failed`**：pnpm 解压 prebuild 时丢了执行位。重跑 `pnpm install`（带 postinstall）或手动 `chmod +x node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper`。
- **手机访问不通**：检查电脑防火墙是否允许 7681 端口；二维码里的 IP 是否与手机同网段。
- **提示符被 zshrc 重置成默认**：这是 `oh-my-zsh` 等框架在 `precmd` 阶段重新设置 PROMPT 导致 — 我们的 hook 只发 OSC 不动 PROMPT，所以你的主题应该正常。
- **复制粘贴**：xterm.js 默认走系统剪贴板。手机长按弹出的菜单优先用 `navigator.clipboard`，HTTPS 才有完整权限；HTTP 局域网下剪贴板 API 受限是浏览器规则。

## 项目结构

```
packages/server/        # Fastify + node-pty + ws
  src/pty/              # PTYSession, manager, OSC parser, ZDOTDIR wrapper
  src/ws/terminal.ts    # /ws/terminal
  src/routes/           # bookmarks / history / files / snippets / qr / sessions
  src/auth.ts           # token + LAN guard
packages/web/           # React + Vite + xterm.js
  src/components/       # Terminal, PaneTree, TabBar, Toolbar, Drawer, FileTree, ...
  src/store/            # zustand: tabs (含 Pane 二叉树), layout, bookmarks, ...
  src/hooks/            # useResponsive, usePTY, useGestures
scripts/
  fix-node-pty-perms.mjs   # postinstall: chmod +x spawn-helper
  ws-smoke.mjs             # 后端冒烟脚本
```
