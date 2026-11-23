# Worker Session HTTP

Implemented in P1 on 2026-11-23. This is the minimal HTTP interface to the project worker runtime, exercised through the same bootstrap as the application. The current browser chat, Flow and child execution still use the existing SessionStore; this change does not switch those callers or complete P2.

The HTTP Host owns authentication, submission facts and process lifetime. A project worker owns native pi Sessions and their history. HTTP clients receive a Session ID and generation, never a worker PID or private IPC credential. Session creation and reopening are explicit actions; reading or controlling a missing worker never starts another process.

All routes inherit token-cookie authentication and same-origin checks. Responses use `Cache-Control: no-store`. Request schemas reject unknown fields and type coercion. Prompt bodies have the ordinary 1 MiB Fastify limit. This first interface accepts text, steering and follow-up; images and the full native configuration/extension UI are not yet wired here.

| Route | Request | Result |
| --- | --- | --- |
| `POST /api/execution/sessions` | `{ projectPath, sessionPath?, model?: { provider, id } }` | `{ session: { projectPath, sessionId, generation, sessionPath } }` |
| `GET /api/execution/sessions/:id` | Query: `projectPath`, `generation` | `{ session, messages, isIdle }` from the native Session |
| `POST /api/execution/sessions/:id/prompt` | Same query; body `{ text, streamingBehavior?: 'steer' \| 'followUp' }` | `202 { ok: true, submissionId }` after the fact transaction commits |
| `POST /api/execution/sessions/:id/abort` | Same query | `{ ok: true }` after native Session abort returns |
| `DELETE /api/execution/sessions/:id` | Same query | Close an idle runtime; preserve native history and facts |
| `GET /api/submissions/:id` | Query: `projectPath` | Persisted submission observation, independent of a live Session |

The Host resolves each live control from its own Session registry. It canonicalizes the project path and checks the generation; a caller cannot retarget a control by supplying a different native file path. A stale generation returns `409 stale-target`. A missing or differently scoped Session returns `404 session-not-open`; a busy close returns `409 session-busy`. Worker loss returns a sanitized `503 worker-unavailable`, with diagnostic output kept in local logs. Other worker command errors carry a validated code across the private IPC channel.

`202` acknowledges a recorded submission, not model success. `prompt-returned` observes a native prompt call returning, which may include an aborted or erroneous assistant response. A queued SDK call remains `accepted / queued-or-handled`; this slice does not collect proof of when that individual input was consumed. Worker loss or Host shutdown marks unresolved inputs `execution-uncertain`. Reopening native history never automatically resubmits them. The snapshot is a current native-history read, not a revisioned or paginated observation feed.

Bootstrap stops new HTTP work before closing resources. Its HTTP `preClose` hook stops workers before HTTP drain, so a control waiting on an unresponsive worker cannot prevent escalation to process termination. Resource cleanup retains the database ownership lease if exit cannot be confirmed. This does not prove that an external tool descendant has also stopped.

Native history ownership remains limited during the migration: the project worker lease coordinates workers sharing one data directory. It does not lock out independent pi processes, another piflow data directory, or the legacy SessionStore. Do not open the same native history simultaneously through the old and new execution paths. P2 must replace the old callers and eliminate that duplicate in-process runtime before presenting the worker path as the default product execution model.

The integration tests use real HTTP listeners, isolated data and agent directories, real SDK worker processes and a local scripted streaming provider. They cover authentication, scope/generation validation, unsupported inputs, abort, project loss, queued uncertainty, Host restart and explicit history recovery without replay. A separate unresponsive-process fixture checks that shutdown finishes, the process has exited and the data-directory lease can be reacquired. These checks do not replace P1.4 tarball installation or full provider/extension acceptance.
