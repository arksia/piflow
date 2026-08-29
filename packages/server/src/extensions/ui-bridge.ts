import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type { ExtensionUIRequest, ExtensionUIResponse, ServerMessage } from '@piflow/protocol'

interface PendingDialog {
  request: ExtensionUIRequest
  resolve: (response: ExtensionUIResponse) => void
}

export interface UiBridge {
  /** Bound to the session via bindExtensions() as its ExtensionUIContext. */
  context: ExtensionUIContext
  /** Dispatch a client ui-response to the suspended dialog. */
  handleResponse: (response: ExtensionUIResponse) => void
  /** Resolve every suspended dialog with cancel semantics (reload/teardown). */
  cancelPending: () => void
  /** Dialogs still awaiting a client answer; embedded in SessionState for reconnect recovery. */
  pendingRequests: () => ExtensionUIRequest[]
}

type DialogMethod = 'select' | 'confirm' | 'input'

interface DialogOptions {
  signal?: AbortSignal
  timeout?: number
}

export function createUiBridge(
  sessionKey: string,
  publish: (message: ServerMessage) => void,
  onPendingChange?: (requests: ExtensionUIRequest[]) => void,
): UiBridge {
  const pending = new Map<string, PendingDialog>()

  function notifyPending() {
    onPendingChange?.(Array.from(pending.values(), dialog => dialog.request))
  }

  // Dialogs suspend without an artificial timeout: the browser keeps them in
  // client state and re-syncs from SessionState.extensionRequests after a
  // reconnect, so a dropped SSE connection never loses a request. The
  // extension-provided signal and timeout are still honored.
  function ask<T>(
    method: DialogMethod,
    fields: Omit<ExtensionUIRequest, 'id' | 'method'>,
    opts: DialogOptions | undefined,
    defaultValue: T,
    parse: (response: ExtensionUIResponse) => T,
  ): Promise<T> {
    if (opts?.signal?.aborted)
      return Promise.resolve(defaultValue)
    const request: ExtensionUIRequest = { ...fields, id: crypto.randomUUID(), method }
    return new Promise<T>((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      function onAbort() {
        cleanup()
        resolve(defaultValue)
      }
      function cleanup() {
        if (timeoutId !== undefined)
          clearTimeout(timeoutId)
        opts?.signal?.removeEventListener('abort', onAbort)
        if (pending.delete(request.id))
          notifyPending()
      }
      opts?.signal?.addEventListener('abort', onAbort, { once: true })
      if (opts?.timeout !== undefined) {
        timeoutId = setTimeout(() => {
          cleanup()
          resolve(defaultValue)
        }, opts.timeout)
      }
      pending.set(request.id, {
        request,
        resolve: (response) => {
          cleanup()
          resolve(parse(response))
        },
      })
      notifyPending()
      publish({ type: 'extension_ui_request', session: sessionKey, request })
    })
  }

  function parseTextResponse(response: ExtensionUIResponse): string | undefined {
    return response.cancelled ? undefined : response.value
  }

  /** Browser theme stub: ANSI styling is meaningless on the web, return text unchanged. */
  const webTheme = {
    fg: (_color: unknown, text: string) => text,
    bg: (_color: unknown, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => '',
    getBgAnsi: () => '',
    getColorMode: () => 'truecolor',
    getThinkingBorderColor: () => (text: string) => text,
    getBashModeBorderColor: () => (text: string) => text,
  } as unknown as Theme

  const context: ExtensionUIContext = {
    select: (title, options, opts) =>
      ask<string | undefined>('select', { title, options }, opts, undefined, parseTextResponse),
    confirm: (title, message, opts) =>
      ask<boolean>(
        'confirm',
        { title, message },
        opts,
        false,
        response => response.cancelled ? false : response.confirmed ?? false,
      ),
    input: (title, placeholder, opts) =>
      ask<string | undefined>('input', { title, placeholder }, opts, undefined, parseTextResponse),
    notify: (message, notifyType) => {
      publish({
        type: 'extension_ui_request',
        session: sessionKey,
        request: { id: crypto.randomUUID(), method: 'notify', message, notifyType },
      })
    },
    // Terminal/editor-bound UI has no web equivalent in S1; stubbed below.
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: <T>() => Promise.resolve(undefined as unknown as T),
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    editor: () => Promise.resolve(undefined),
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return webTheme
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'themes are not supported in piflow' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  }

  return {
    context,
    handleResponse: (response) => {
      pending.get(response.id)?.resolve(response)
    },
    cancelPending: () => {
      for (const [id, dialog] of pending)
        dialog.resolve({ id, session: sessionKey, cancelled: true })
    },
    pendingRequests: () => Array.from(pending.values(), dialog => dialog.request),
  }
}
