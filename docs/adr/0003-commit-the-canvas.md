# Commit the canvas, not a module graph

Supersedes ADR 0001.

A node is whatever the user puts on the canvas. The shared file is `<project>/.piflow/canvas.json`: node id, name, Brief, links, and position. Brief is the standing text injected for that node, as AGENTS.md is for a repository, and it may be empty. Viewport, session paths, goals, and messages stay in the piflow data directory because they belong to one machine. A viewport save must not add, remove, or rewrite nodes in the shared file.

Version 1 grows by optional fields. Unknown fields are written back. An unrecognized version is not written. An existing `.piflow/modules.json` is read once, positions are taken from the local canvas when present, and the result is written as `canvas.json`.

Considered keeping the module file and treating that workflow as the only use. That made one way of using the canvas into the file format.
