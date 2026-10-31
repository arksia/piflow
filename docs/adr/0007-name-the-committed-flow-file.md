# Name the committed project file `flow.json`

The committed project Flow document is `<project>/.piflow/flow.json`. It contains the project-owned node configuration, Briefs, links, and positions described in ADR 0003. Local bindings, goals, viewport, messages, and run history remain in the piflow data directory.

Readers migrate a valid `<project>/.piflow/canvas.json` to `flow.json` when the new file is absent. If both files exist, `flow.json` wins and the legacy file is left untouched. Unsupported or invalid legacy documents are never removed.

The name follows the product concept users work with: Flow. Considered retaining `canvas.json`, which describes the visualization rather than the project data it stores.
