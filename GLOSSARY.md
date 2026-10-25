# piflow

A local browser GUI for pi, with a project canvas beside the sessions doing the work.

## Language

**Node**:
A card on the canvas with a stable identity, a name, and a Brief.
_Avoid_: module, agent

**Brief**:
The standing text injected for a node, as AGENTS.md is for a repository.
_Avoid_: prompt, system prompt, goal, module

**Link**:
A user-owned connection between two nodes.
_Avoid_: edge, channel

**Binding**:
The pi session attached to a node on this machine.
_Avoid_: node

**Goal**:
What the bound session on a node is trying to do.
_Avoid_: brief

**Canvas**:
The nodes, their briefs, their links, and where the nodes sit.
_Avoid_: board, module graph

**Conductor**:
The role that proposes changes to nodes, their briefs, and links. The canvas takes those changes only when the user accepts them.
_Avoid_: module, agent

**Draft**:
Node and link changes a Conductor has presented and the user has not accepted.
_Avoid_: proposal, commit, message

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
The lifecycle of a delivery from one Node to a neighboring Node along a Link.
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
