# At-paths stay text, and the slash menu skips builtin commands

An At-path is a file or directory in the session's working directory, written into the message as `@` plus that path. Choosing one does not paste the file into the message. The message stays the text the user sends, which is also how pi's editor treats `@`.

The slash menu lists Session commands only: extension commands, prompt templates, and skills. Builtin commands such as `/compact`, `/model`, and `/new` stay out. Those run in pi's terminal UI. Sending them from this composer would hand the model an ordinary message.

Considered inlining file contents the way a pi command-line `@file` argument does. That would make the same mark mean two different messages. Also considered listing every builtin slash command beside the ones this session can run. A row that cannot run is a trap.
