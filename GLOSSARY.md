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
_Avoid_: proposal, commit
