---
status: accepted
---

# Use pi SDK with project execution processes

The accepted target uses `@earendil-works/pi-coding-agent@1.5.2` for both main and child Sessions, retaining pi's native loop, history and extension model without a second runtime or a custom Fiber framework. To reduce repeated SDK loading, trusted Sessions in one project share an execution process separate from the HTTP Host: normal cancellation targets a Session and its owned children, while forcibly terminating that process interrupts every active Session it hosts. After a crash, restore history and evidence, mark interrupted or uncertain work, and require explicit user continuation rather than replaying unknown side effects; browser disconnection does not cancel execution.

Accepted on 2026-11-16 after P0 evaluation; implementation and migration are pending. The target minimum Node version is 22.19.0; project-level process isolation is not a security sandbox or a guarantee that external tool processes have stopped.
