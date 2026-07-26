# piflow

Stay in your flow. Let pi do the work.

pi coding agent 的安静浏览器界面——纯黑底、灰阶文字，唯一的紫色信号只在 agent 工作时亮起。

## 特性（MVP）

- **多会话管理**：浏览/新建/切换会话，直接读写 `~/.pi/agent/sessions/`，与终端 `pi -c` 完全互通
- **流式聊天**：markdown + Shiki 高亮，思考块折叠
- **工具卡片**：调用默认退隐半透，`edit` 渲染 diff 视图，执行中紫色信号呼吸
- **steer 语义**：agent 工作中发消息自动作为 steering 插队传达
- **中断**：一键 abort

## 开发

```bash
pnpm install
pnpm dev        # server :3141 + vite dev :3142 (HMR)
```

打开 http://localhost:3142

## 生产

```bash
pnpm build      # 构建 web → web/dist
pnpm start      # server 同时托管静态文件，访问 http://127.0.0.1:3141
```

局域网访问：`HOST=0.0.0.0 pnpm start`（⚠️ 无认证，仅限可信网络）

## 架构

```
浏览器 (Vue 3) ──WebSocket──► server (Node) ──SDK 同进程──► pi agent
```

- `server/`：薄转发层。会话池管理多个 `AgentSession`，事件流广播给所有客户端
- `web/`：Vue 3 + Vite。markdown-it + Shiki(slack-dark)
- 设计语言来自 [arksia.me](https://github.com/arksia/arksia.me)：扁平、无阴影、退隐式交互、紫色仅作"系统工作中"信号

## 路线图

- 二期：远程访问（Tailscale + 认证）、PWA、会话树可视化（fork/branch）
