# Commit the module graph in the project

Superseded by ADR 0003.

A module's identity, brief, and links are project knowledge, so they are stored in `<project>/.piflow/modules.json` and can be committed. Bindings, positions, viewport, and messages stay in the piflow data directory because they differ per machine and contain absolute session paths.

The file carries an integer `version`. Version 1 grows by optional fields: a missing field defaults, and fields this reader does not know are written back unchanged. A reader that does not recognize the version refuses to load the file and does not write it back. The version increments only when an older reader would misread the document.

Considered committing the whole canvas file, which churns on every viewport move and leaks local paths, and one markdown file per module, which makes links and a single parse step harder.
