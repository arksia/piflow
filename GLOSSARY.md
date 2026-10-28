# piflow

A local browser GUI for pi, with a project canvas beside the sessions doing the work.

## Language

**Node**:
画布上具有稳定身份、名称和 Brief 的配置实体，可表示长期 Agent 或 Subagent 角色。
_Avoid_: module, run

**Brief**:
The standing text injected for a node, as AGENTS.md is for a repository.
_Avoid_: prompt, system prompt, goal, module

**Link**:
用户创建的长期 Agent 之间的持久通信连接，不等同于主 Agent 对 Subagent 的一次调用。
_Avoid_: edge, channel

**Binding**:
本机上附着于长期 Agent 的 pi 会话；Subagent 角色没有唯一的长期绑定。
_Avoid_: node

**Goal**:
What the bound session on a node is trying to do.
_Avoid_: brief

**Canvas**:
用户配置的节点、Brief、成员关系、通信连接及节点位置。
_Avoid_: board, module graph

**Conductor**:
The role that proposes changes to nodes, their briefs, and links. The canvas takes those changes only when the user accepts them.
_Avoid_: module, agent

**Draft**:
Node and link changes a Conductor has presented and the user has not accepted.
_Avoid_: proposal, commit, message

## Agent 编排

**Persistent Agent（长期 Agent）**:
拥有持续对话上下文的协作实体；用户可显式启用它的编排能力。
_Avoid_: Subagent Role, Subagent Run

**Main Agent（主 Agent / 编排者）**:
已启用编排能力的长期 Agent，负责调用 Subagent 角色、接收结果并继续处理任务。
_Avoid_: 模块, Conductor, 父会话

**Subagent Role（Subagent 角色）**:
用户配置、可重复调用的职责定义；多个主 Agent 可以共享同一角色，各次调用的上下文互相独立。
_Avoid_: 长期会话, Subagent Run, 固定角色枚举

**Membership（成员关系）**:
主 Agent 与其默认使用的 Subagent 角色之间的组织关系，不等于通信连接或执行授权。
_Avoid_: Link, 会话血缘, 工具调用

**Subagent Run（Subagent 运行）**:
主 Agent 调用某个角色后产生的一次独立执行，具有自己的任务输入、有效配置、状态和结果。
_Avoid_: Subagent Role, Binding, A2A Active Run

## Message

**Message**:
The text the user sends to a session.
_Avoid_: brief, goal, draft, prompt, chat history message

**At-path**:
A file or directory in the session's working directory, named where `@` starts a token in a message.
_Avoid_: attachment, source, node

**Session command**:
An extension command, a prompt template, or a skill, named when a message's first character is `/`.
_Avoid_: builtin command, shell command, tool

## A2A

**A2A**:
长期 Agent 之间沿用户已有 Link 投递消息并接收回复的生命周期。
_Avoid_: agent, link message

**Queue Entry**:
A delivery from one Node to a neighboring Node that has not yet appeared in the target session transcript. While that session is replying, it waits outside it.
_Avoid_: sent message, outbox, follow-up

**Chat History Message**:
That same delivery, once it appears in the target Node's session transcript.
_Avoid_: Message, queue entry

**Active Run**:
The run on the target Node started by one A2A delivery.
_Avoid_: Binding, session, reply

**Read**:
An A2A delivery whose run on the target Node has begun.
_Avoid_: Chat History Message, Reply

**Reply**:
The one answer a Node submits for an A2A delivery, addressed by that delivery's id.
_Avoid_: Chat History Message, Message
