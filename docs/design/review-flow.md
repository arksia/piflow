# DESIGN-REVIEW: 固定修订上的统一交付审查

对应 [需求及验收标准](../requirements/review-flow.md)。Reviews 拥有固定源码、文档目录、diff、路线和人工记录；SubagentRuns 继续拥有命令、声明和 Git 观察。界面组合两者的引用，不复制执行账本。角色名称不控制能力：每次 `delivery: 'code'` 开启源码比较，可用 `reviewId` 将返工关联到原基线。

## DESIGN-REVIEW-SNAPSHOT: 先固定版本，再解释变更

运行前采集基线，可靠观察到进程关闭后采集终点。正文按内容身份保存，完成采集后事务写入私有 `reviews.sqlite`；schema 2 为范围排除增加表，兼容 schema 1。Review 可跨 Run，新 Revision 保留最初基线；显式更新源码且内容或文档变化才生成新修订。采集失败不改变 Code 执行结果。未可靠关闭、非仓库、历史缺失保持不可用。

采集 tracked 与非 ignored 的 untracked 文本，读取 UTF-8，拒绝 symlink 和特殊文件，不执行仓库代码、过滤器、hooks 或 fsmonitor。每次最多 500 文件、单文件 1 MiB、总正文 20 MiB、15 秒；读前后状态及末尾目录复核只能发现部分并发变化，不承诺原子快照。清单和缺失正文分开保存，预算遗漏不能被解释成文件删除。

真实 diff 使用固定前后正文。TS/JS/TSX/JSX 通过 TypeScript AST 定位变动函数、方法和回调，文件内唯一名称配对；无法定位的语言或非函数变化保留文件级对象。AST 每文件最多 20,000 节点、500 函数、100 层，总目录最多 5,000 对象；diff 每文件 100 ms / 20,000 编辑，总 8 MiB / 3 秒。达到预算降级并记录缺口，不假装完整。

文档目录来自 `docs/PRD.md`、`docs/requirements/`、`docs/design/`、`docs/adr/`，最多 2,000 章节。显式 `{#id}` 及 `REQ-`、`AC-`、`DESIGN-` 标题可作为稳定锚点；重复或自动生成锚点明确不稳定。预览只读取固定章节，Markdown 沿用 sanitize。

## DESIGN-REVIEW-CONTRACT: 模型输出如何成为路线

1. 用户或主 Agent 显式生成，宿主绑定项目、Review、Revision、源 Code 模型和固定分析包。
2. 独立分析 Run 仅有 `read_review_context` 和 `submit_review_route`。禁用 bash、读当前工作区、编辑、项目扩展、MCP、技能和 live context 文件。
3. 模型分页读取 catalog、source、document、evidence；每页 12,000 字符，游标绑定修订、类型和对象。所有正文是数据，不是新指令。
4. `submit_review_route` 提交 schema 1、revisionToken、steps、relations、gaps，最大 128 KiB / 50 步。目标及文档都引用宿主 ID，步骤解释使用用户语言。
5. 宿主从完整工具结果提取结构，二次验证 schema、引用类型、修订、唯一步骤 key 和阅读顺序无环，再保存路线版本及来源 Run/toolCallId。最终 Markdown 不参与解析。工具本地校验成功不等于宿主已保存。

分析最多 5 分钟，同修订生成去重，失败/取消不覆盖有效路线。重启将未完成分析标 interrupted 并推进版本。只有生成明确调用模型；普通 GET 和 SSE 同步不生成。主 Agent 的 `review_delivery` 仅能读摘要或请求生成，不能写人工决定。

每个代码步骤尽量直接关联需求、方案和 ADR；纯文档步骤合法，缺依据保留 gap。关系是模型提出的阅读或语义联系，不是观察到的运行调用图。命令从原 `(runId, toolCallId)` 引用，当前 `sourceVersion: unknown`，退出零不能证明该修订测试通过。

## DESIGN-REVIEW-STATE: 建议、范围与人工记录分别保存

变更对象可同时出现在多个步骤，但每修订只保留一份人工记录。已看、略过与归类无关。共享 hunk 涉及的对象全部关联后才算归类；未归类范围为实际 hunk 差集，再减用户附理由排除的 hunk。排除仍可查看和恢复。新源码/文档修订整体待审，路线重排和关联调整只增加路线版本。

SSE 只发布身份及轻量版本；打开的 reader 串行合并刷新，拒绝跨项目、迟到修订和倒退版本。正文只随选择读取，diff 以 500 行渐进显示。生成失败、未知历史和同步错误可见，保留已载入信息。

路线意图通过 JSON 下载/上传携带相对路径、符号与文档锚点，导入在当前修订唯一定位，失效/歧义列 gap。不导出正文、机器 ID、人工记录或命令证据，不自动写入仓库。可由用户放入 `.piflow/reviews/` 提交。删除审查会清理无引用源码正文，保留原 Run 与删除说明。

## DESIGN-REVIEW-UI: 同一个交付工作台

聊天保留一个“审查交付”，打开原有“交付 / 步骤 / 输出”。交付内按文件/按功能切换，共享 diff、来源预览和人工记录；扩展同一 inspector 获得代码阅读空间。左侧是路线/对象，右侧是上下文与 diff，窄容器上下排列。输入框仅在添加意见、调整范围时出现。

证据进入原“步骤”后返回原选择，tab 保存滚动位置。需修改意见汇总到已有会话输入框，追加原草稿，不自动发送。没有强制接受路线或最终审批操作。

交互参考 affectUI 的 [Review Center](https://www.affectui.com/components/review-center)、[Cited Answer](https://www.affectui.com/components/cited-answer)、[Agent Plan](https://www.affectui.com/components/agent-plan)、[Comments Panel](https://www.affectui.com/components/comments-panel) 和 [Agent Checkpoints](https://www.affectui.com/components/agent-checkpoints) 的公开描述；使用现有 piflow 样式、图标与布局，未复制 Pro 源码。

Raven 固定提交 `9b0bd0845204969f4fa5da815d03a471451dd489` 的工具化 todo、宿主 manifest 和权限策略提供参考；PRD→设计→ADR→diff 路线及解析协议独立设计。核心取舍见 [ADR 0010](../adr/0010-fixed-review-revisions.md)。

首版限制：其他语言采用文件级定位；工作区缺少原子隔离；纯提交比较有后端接口，但暂无独立创建界面，也不能在无关联模型配置时生成路线；不提供 IDE、自动合并、多人审批或可执行调用链。
