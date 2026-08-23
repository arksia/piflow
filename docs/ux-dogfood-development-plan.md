# piflow UX Dogfood 与开发任务

**状态：** 待由 piflow 执行

**日期：** 2026-08-19

**执行模型：** Kimi K3

**目标：** 以真实开发者的连续使用过程审视 piflow，先修复会阻塞工作流的体验问题，再逐步增加工作台能力。

## 1. 任务说明

你不是在实现一个通用聊天 UI，而是在改进一个本地 coding-agent 工作台。请把 piflow 当作每天使用的工具，沿着下面的自然工作过程操作并记录观察：

1. 打开 piflow，恢复上次未完成的会话。
2. 在同一个项目中创建第二个会话，比较两个会话的目标和状态。
3. 发送一个探索代码库的任务。
4. Agent 流式输出时阅读旧消息，并追加一条 steering 或 follow-up 指令。
5. Agent 执行工具时展开输出、查看 diff、复制命令或错误。
6. 中断一次运行，再判断它是否真的停止。
7. 切换到另一个会话，回来后检查草稿、滚动位置和状态是否保留。
8. 在 Chat 与 Flow 间切换，打开一个节点，再回到原会话。
9. 模拟连接断开、provider 失败、工具失败和空会话。
10. 在 390px 左右的移动宽度下完成一次查看、追加和停止操作。

每一步都回答四个问题：

- 我现在知道系统处于什么状态吗？
- 我知道下一步能做什么吗？
- 操作后是否立即得到反馈？
- 失败后是否有恢复路径？

不要为了“看起来更丰富”增加装饰。只有能减少等待、误解、上下文切换或数据丢失的变化才进入实现。

## 2. 当前代码基线

- Web：React 19 + Vite + TypeScript + CSS Modules。
- 状态：`useSyncExternalStore` 包装的进程内 store。
- 传输：HTTP command + 单条 SSE event stream。
- Agent runtime：pi，piflow 不得复制 runtime 状态或实现第二套 Agent。
- Flow：`@xyflow/react`，负责节点、边、缩放、拖拽和选择。
- Markdown：React Markdown，代码高亮和流式渲染在前端完成。
- 现有状态字段：`connected`、`isStreaming`、`isCompacting`、队列、错误、tool results、context。

优先复用现有实现。第一阶段不要引入 Ant Design、MUI、Chakra、Radix 全家桶、Zustand、React Query 或动画框架。

## 3. Dogfood 观察记录模板

每完成一轮真实操作，追加一条记录：

```md
### [日期] [场景]

- 用户意图：
- 实际操作：
- 可见状态：
- 发生的阻塞或误解：
- 影响等级：P0 / P1 / P2 / P3
- 证据：文件、状态字段、截图或复现步骤
- 最小修复：
- 是否需要协议或 server 改动：是 / 否
```

不要把“我更喜欢另一种颜色”当成问题。优先记录错误状态、操作不可发现、状态不可信、滚动被抢、输入丢失、重复发送、移动端不可操作和恢复路径缺失。

## 4. 重点缺失功能

### P0：可靠性与状态可信度

- 连接状态从 boolean 扩展为 `connecting`、`connected`、`reconnecting`、`error`。
- 中断操作增加 `stopping`，不能点击后继续显示“生成中”而没有反馈。
- 区分 `idle`、`running`、`compacting`、`queued`、`failed`、`interrupted`。
- server 重启或 SSE 世代变化导致的运行中任务显示为 `interrupted`，不能伪装为空闲。
- prompt、model、thinking、flow 保存失败都要有可见错误和重试入口。
- 发送失败时保留草稿，不能静默丢失用户输入。

### P1：日常操作效率

- 会话列表搜索：名称、首条消息、cwd、最近活动。
- 会话重命名；第一版不实现真实删除，只支持从列表隐藏或明确确认后再扩展。
- 每个会话独立保存草稿和滚动位置。
- 聊天滚动离开底部后显示“回到最新”，新内容不能抢走用户阅读位置。
- 工具卡片显示可读动作类型、运行状态、输出、diff、复制和展开全部。
- Chat / Flow 切换保留 Chat scroll 和 Flow viewport。
- 标题栏显示会话名、项目路径和统一状态。

### P2：工作台能力

- 左侧栏宽度拖拽和持久化。
- 轻量右侧上下文抽屉：目标、cwd、状态、最近活动、Flow 连接摘要。
- Flow 双击节点打开会话。
- Flow 适配画布、聚焦当前会话、键盘删除和基础撤销/重做。
- `Cmd/Ctrl + B` 切换侧栏，`Cmd/Ctrl + K` 打开会话搜索。

### P3：后续方向

- 结构化决策和权限请求。
- review-ready 状态及文件变更导航。
- Git、文件树、终端等右侧面板。
- 可恢复的 Flow 活动账本。
- 超过 500 条消息且出现实测卡顿后，再评估虚拟列表。

## 5. 第一阶段实现范围

第一阶段只实现以下五组改动：

1. 统一状态模型和状态文案。
2. 使用 `lucide-react` 替换 Unicode glyph 操作图标。
3. ToolCallCard 增加动作类型、状态文字、复制输出、展开全部和错误恢复入口。
4. ChatView 增加“回到最新”、稳定的滚动跟随和发送失败保留草稿。
5. 移动端侧栏与模型 popover 补齐 Escape、焦点恢复、dialog 语义和 44px 触控尺寸。

第一阶段不得修改 pi session 文件格式，不得复制完整 transcript 到 Flow，不得引入大型 UI 框架，不得添加营销式空状态。

## 6. 图标与组件约定

图标库使用 `lucide-react`。业务按钮禁止混用 Unicode glyph、emoji 和手写图标。建议映射：

| 行为 | 图标 |
| --- | --- |
| 打开侧栏 | `PanelLeft` |
| 新建会话 | `Plus` |
| 搜索 | `Search` |
| 聊天 | `MessageSquare` |
| Flow | `Workflow` |
| 发送 | `Send` |
| 停止 | `Square` |
| 展开 | `ChevronRight` |
| 复制 | `Copy` |
| 重试 | `RefreshCw` |
| 更多 | `MoreHorizontal` |
| 错误 | `CircleAlert` |
| 完成 | `Check` |

第一阶段只抽两个基础组件：

- `IconButton`：固定尺寸、tooltip、`aria-label`、focus、hover、disabled。
- `StatusBadge`：统一状态文字、颜色、动画和 reduced-motion 行为。

不要把所有按钮抽成一个带几十个 prop 的通用组件。

## 7. 丝滑交互的实现规则

### 更新调度

- 高频 `message_update` 和 `tool_execution_update` 每帧最多触发一次 React 更新。
- `message_end`、`agent_settled`、错误和队列变化立即刷新。
- 继续使用现有 `requestAnimationFrame` 批处理，不增加全局 debounce。

### 滚动

- 距离底部小于 160px 时自动跟随。
- 用户主动上翻后停止自动滚动。
- 流式更新直接设置 `scrollTop`，不要累积 smooth scroll 动画。
- 用户点击“回到最新”时才使用平滑滚动。

### 流式 Markdown

- 短文本继续实时 Markdown。
- 长文本或尚未闭合的代码块使用普通 pre，完成后再高亮。
- 不要在每个字符更新时重复运行 Shiki。

### 布局稳定

- 发送/停止按钮固定尺寸。
- 状态区预留最小宽度，避免标题跳动。
- 工具卡片展开不改变上方内容位置。
- 弹层不能被 `overflow: hidden` 容器裁切。

### 动画

```css
--motion-fast: 120ms;
--motion-normal: 180ms;
--motion-slow: 240ms;
--ease-standard: cubic-bezier(.2, .8, .2, 1);
```

动画只表达状态变化、展开收起、侧栏移动和操作反馈。所有持续动画必须有 `prefers-reduced-motion` 分支。

## 8. 验收标准

### 功能

- 用户能在 3 秒内找到新建会话、发送、停止和 Chat / Flow 切换。
- 运行中、压缩、排队、停止中、失败、断线重连有不同且可读的状态。
- 工具输出可展开、复制，diff 可辨识，错误可重试或复制。
- 离开底部阅读旧消息时，新消息不会抢滚动。
- 发送失败不会丢失输入。
- 侧栏和模型选择器可用 Escape 关闭，关闭后焦点回到触发按钮。
- 390px 宽度下可以打开会话、发送、追加、停止和查看错误。

### 性能

- 发送操作 100ms 内出现反馈。
- 普通流式更新不产生长于 50ms 的主线程任务。
- 100 条消息滚动无明显跳动。
- SSE 高频更新不会导致全页面重渲染。

### 工程

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- 为状态映射、滚动跟随、失败恢复增加最小回归测试。
- 不修改无关文件，不重写现有 session 或 Flow 数据。

## 9. Kimi K3 执行协议

请使用 Kimi K3 按以下阶段执行，不要一次性实现所有 P2/P3：

### 阶段 A：观察与基线

- 阅读 `PRODUCT.md`、`DESIGN.md`、本文件和 `docs/session-status-dogfood.md`。
- 启动本地 piflow，按第 1 节完成一轮操作。
- 记录至少 5 条带证据的 dogfood 观察。
- 只修复阻塞级 P0，不做视觉大改。

### 阶段 B：基础交互

- 实现状态文案、图标、ToolCallCard 和回到底部。
- 增加针对状态和交互的最小测试。
- 运行 lint、typecheck、build。
- 用桌面和 390px 宽度做一次验收。

### 阶段 C：二次 dogfood

- 从“打开上次会话”开始完整复走流程。
- 重点观察：中断、追加、错误恢复、滚动、模型弹层和移动端。
- 若出现新的 P0/P1，先总结并暂停，不继续扩展 P2。

### 阶段 D：工作台增强

- 只有阶段 B、C 的基础交互稳定后，才实现搜索、侧栏宽度和上下文抽屉。
- 每个功能独立提交，保持可以回滚。

每个阶段结束时输出：完成项、未完成项、dogfood 证据、测试结果、剩余风险和下一阶段建议。若 Kimi K3 额度耗尽或 provider 失败，保留当前工作并停止，不能声称未验证的功能已完成。

## 10. 未来观察方向

下一轮 dogfood 重点观察：

- 用户是否理解“继续当前会话”和“创建干净会话”的差异。
- 用户是否能判断一个长期 Flow 节点是否仍适合复用。
- server 重启后“中断”状态是否比“空闲”更可信。
- 工具输出是否足以支持 review，而不需要打开终端。
- 多个后台会话同时运行时，状态提示是否过载。
- 移动端短暂介入是否真的可以不回桌面。
- 哪些信息应该进入 Flow 节点，哪些应该留在 Chat 或上下文抽屉。

原则：先增加可判断性，再增加自动化；先修复事实和恢复路径，再做视觉和动画。

## 11. 阶段 A Dogfood 记录（2026-08-19，Kimi K3）

> 本轮受环境约束：禁止启动、停止或清理任何服务。K3 通过静态审查完成 Web 修复，并运行 lint、typecheck 和 build；它没有直接操作浏览器，所有涉及浏览器视觉的判断均按要求标记为未验证，未伪造验收。

### [2026-08-19] Dogfood 中误杀宿主服务，自身任务中断

- 用户意图：在 dogfood 前清理占用 3141 的旧 server，获得干净环境。
- 实际操作：agent 执行 `kill 80091 80085 84839` 和 `pkill -f vite`，其中 80091 正是承载当前会话的 piflow server。
- 可见状态：当前 turn 立即中断，UI 没有任何机会提示“你的 agent 正在杀死自己”。
- 发生的阻塞或误解：piflow server 与使用它的 agent 同进程命运；agent 把宿主当成普通 stale 进程。这是真实阻塞。
- 影响等级：P0
- 证据：上一 turn 的 bash 调用记录；本 turn 用户确认“杀掉了承载你自己的 piflow server”。
- 最小修复：流程约束（本轮起生效：禁止 agent 管理服务生命周期）；产品层面 server 可在 `/api/sessions` 或 hello 中声明自己承载的会话，供 agent 自查（后续阶段评估）。
- 是否需要协议或 server 改动：本轮否。

### [2026-08-19] 断线期间状态互相矛盾，恢复后安静回到 idle

- 用户意图：server 被杀又恢复后，判断刚才的运行是否还在。
- 实际操作：宿主 server 终止 → SSE 断开 → 外部恢复服务 → 页面重连。
- 可见状态：断线时标题栏显示“连接中…”，同时输入区仍显示“回复中 · 发送将插队传达”（互相矛盾）；重连后 `resync → applyState` 无条件把 `isStreaming` 覆盖为 false，会话安静回到空闲，没有任何“上次运行已中断”的提示。
- 发生的阻塞或误解：状态不可信——用户无法区分“已完成”和“被杀死”。
- 影响等级：P0
- 证据：`apps/web/src/components/ChatView/index.tsx`（statusText 只看 connected/isCompacting/isStreaming）；`apps/web/src/components/InputBar/index.tsx`（“回复中”只看 `view.isStreaming`）；`apps/web/src/session/reducer.ts` `applyState` 无条件覆盖；`apps/server/src/server/sessions.ts` `openSession` 无条件 `setStatus(managed, 'idle')`，且内存 `statuses` registry 随进程消失。
- 最小修复：本轮仅修复断线状态矛盾——ChatView/InputBar 用局部 `isLive = store.connected && !!view?.isStreaming` 同时门控 streaming 样式、“回复中”文案、“正在生成…”和停止/发送按钮分支，断线时一律只显示“连接中…”并回到发送按钮。曾尝试“从持久消息推导 interrupted”，因协议无 server generation、异常终止无可区分的 stopReason，不满足“可靠”而被驳回；**interrupted 本轮未实现**，留待有 server generation 语义后再做。
- 是否需要协议或 server 改动：本轮否（改动只在 Web 组件内）；`interrupted` 需要 server generation 支持，未做。

### [2026-08-19] 恢复后的会话列表标题是首条长 prompt，难以辨识

- 用户意图：服务恢复后快速找回“刚才那个 dogfood 任务”。
- 实际操作：查看会话列表。
- 可见状态：任务可找到，但标题是首条长 prompt 的截断，无法一眼确认目标。
- 发生的阻塞或误解：操作不可发现/辨识成本高，非阻塞。
- 影响等级：P1
- 证据：`apps/server/src/server/sessions.ts` `listSessions` 使用 `firstMessage.slice(0, 120)`；`apps/web/src/components/SessionList/index.tsx` 以 `name || firstMessage` 显示。
- 最小修复：P1 阶段的会话重命名；本轮不动。
- 是否需要协议或 server 改动：否（重命名需要 server 支持时另行评估）。

### [2026-08-19] 新建会话时路径、模型与额度可见（正向）

- 用户意图：确认新会话的工作目录、模型和剩余额度。
- 实际操作：静态审查新建会话与输入区代码路径。
- 可见状态：项目路径（NewSessionDialog 目录选择）、当前模型名、各 provider 额度窗口与重置时间、上下文用量百分比均直接可见。
- 发生的阻塞或误解：无。这是值得保留的正向体验。
- 影响等级：无（正向记录）
- 证据：`apps/web/src/components/InputBar/index.tsx` `formatWindow`/quota/model 按钮；`apps/web/src/components/NewSessionDialog/index.tsx`。
- 最小修复：无。
- 是否需要协议或 server 改动：否。

### [2026-08-19] CLI 直接访问 loopback API 返回 unauthorized，认证启动路径不可见

- 用户意图：用 curl 快速验收 server 行为。
- 实际操作：`curl http://localhost:3141/api/sessions` → `{"error":"unauthorized"}`，而浏览器正常工作。
- 可见状态：对开发者表现为“API 坏了”，实际是认证 bootstrap 不可见。
- 发生的阻塞或误解：loopback 下 `/auth` 无条件 204 并种 cookie，`/api/*` 只认 cookie；浏览器 `transport.ts` 先打 `/auth`，CLI 用户无从得知这一步。
- 影响等级：P2（开发者体验，不阻塞产品用户）
- 证据：`apps/server/src/server/routes.ts` `handleAuthRequest`（`config.isLoopback || suppliedToken === …`）与 `isAuthenticated`（只查 cookie）；`apps/web/src/session/transport.ts` `connect()` 先请求 `buildAuthPath`。
- 最小修复：在 README 或 server 启动日志中说明 `/auth` bootstrap；本轮不改代码。
- 是否需要协议或 server 改动：否。

## 12. 使用者复核记录（2026-08-20）

### 流式期间追加 steering 能有效改变实现方向

- 实际操作：K3 已开始实现基于 transcript 的 `interrupted` 推导时，使用者在生成期间追加约束，指出该判断缺少 server generation 和可靠终止证据。
- 结果：K3 在当前 turn 内收到指令，明确撤回启发式实现，清理 protocol/server 改动，转为修复可证实的断线展示矛盾。
- 判断：这是正向体验，说明流式 steering 对自然 code review 有实际价值。后续应继续观察指令送达、排队和生效时机是否始终清晰。

### 同一会话内的 review 闭环可用，但 diff 审查仍依赖外部工具

- 实际操作：K3 首版把中文展示文案放入 protocol，并遗漏断线时停止按钮和 streaming 样式；使用者通过外部 `git diff` 发现问题，再把 review 反馈发回同一会话。
- 结果：K3 将改动收敛为两个 Web 组件内的局部 `isLive` 门控，并重新通过 lint、typecheck 和 build。
- 判断：piflow 支持“实现 -> review -> 修正”的连续协作，但当前 Chat 工具卡片不提供聚合 diff 视图，使用者仍需切换到外部终端才能完成可靠审查。这是 P1 工作台能力，不应在阶段 A 扩展实现。

### 长会话的额度下降明显，但不能直接归因为 piflow 缺陷

- 证据：本轮开始时 Kimi K3 的 5h 额度为 100%，首轮实现完成后为 60%，review 修正后为 53%。
- 判断：消耗与 K3、长 transcript、重复读取和返工共同相关，不能仅凭一次观察归因给 piflow。它仍提示一个产品方向：长任务应更容易拆到独立 Flow 会话，并通过精确上下文检索共享必要信息，避免每次 correction 携带全部历史。

### 外部浏览器复核结果

- 使用者在不重启服务的前提下刷新 `http://127.0.0.1:3141`，页面正常加载并恢复同一 K3 会话，未出现空白页或会话丢失。
- 精确断线场景未复测：当前没有不影响宿主任务的网络故障注入路径，不能据此声称断线 P0 已完成端到端验收。
