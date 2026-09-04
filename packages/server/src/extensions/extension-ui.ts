import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  Theme,
} from '@earendil-works/pi-coding-agent'

interface PendingDialog {
  request: RpcExtensionUIRequest
  settle: (response?: RpcExtensionUIResponse) => void
}

type RpcExtensionUIRequestInput = RpcExtensionUIRequest extends infer Request
  ? Request extends RpcExtensionUIRequest ? Omit<Request, 'type' | 'id'> : never
  : never

export function createExtensionUIContext(
  publish: (request: RpcExtensionUIRequest) => void,
  onStateChange: () => void,
) {
  const pending = new Map<string, PendingDialog>()
  const statuses = new Map<string, RpcExtensionUIRequest>()
  const widgets = new Map<string, RpcExtensionUIRequest>()

  function ask<T>(
    request: RpcExtensionUIRequestInput,
    options: ExtensionUIDialogOptions | undefined,
    fallback: T,
    parse: (response: RpcExtensionUIResponse) => T,
  ): Promise<T> {
    if (options?.signal?.aborted)
      return Promise.resolve(fallback)

    const fullRequest = {
      type: 'extension_ui_request',
      id: crypto.randomUUID(),
      ...request,
    } as RpcExtensionUIRequest

    return new Promise<T>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      let abort: () => void
      const cleanup = () => {
        if (timeout)
          clearTimeout(timeout)
        options?.signal?.removeEventListener('abort', abort)
        if (pending.delete(fullRequest.id))
          onStateChange()
      }
      const settle = (response?: RpcExtensionUIResponse) => {
        cleanup()
        resolve(response ? parse(response) : fallback)
      }
      abort = () => settle()

      if (options?.timeout !== undefined)
        timeout = setTimeout(abort, options.timeout)
      options?.signal?.addEventListener('abort', abort, { once: true })
      pending.set(fullRequest.id, { request: fullRequest, settle })
      onStateChange()
      publish(fullRequest)
    })
  }

  function emit(request: RpcExtensionUIRequestInput) {
    publish({
      type: 'extension_ui_request',
      id: crypto.randomUUID(),
      ...request,
    } as RpcExtensionUIRequest)
  }

  function setWidget(
    key: string,
    content: string[] | ((...args: never[]) => unknown) | undefined,
    options?: ExtensionWidgetOptions,
  ) {
    if (content !== undefined && !Array.isArray(content))
      return
    const request = {
      type: 'extension_ui_request',
      id: crypto.randomUUID(),
      method: 'setWidget',
      widgetKey: key,
      widgetLines: content,
      widgetPlacement: options?.placement,
    } satisfies RpcExtensionUIRequest
    if (content === undefined)
      widgets.delete(key)
    else
      widgets.set(key, request)
    publish(request)
    onStateChange()
  }

  const plainTheme = {
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
    select: (title, options, dialogOptions) => ask(
      { method: 'select', title, options, timeout: dialogOptions?.timeout },
      dialogOptions,
      undefined,
      response => 'value' in response ? response.value : undefined,
    ),
    confirm: (title, message, dialogOptions) => ask(
      { method: 'confirm', title, message, timeout: dialogOptions?.timeout },
      dialogOptions,
      false,
      response => 'confirmed' in response ? response.confirmed : false,
    ),
    input: (title, placeholder, dialogOptions) => ask(
      { method: 'input', title, placeholder, timeout: dialogOptions?.timeout },
      dialogOptions,
      undefined,
      response => 'value' in response ? response.value : undefined,
    ),
    editor: (title, prefill) => ask(
      { method: 'editor', title, prefill },
      undefined,
      undefined,
      response => 'value' in response ? response.value : undefined,
    ),
    notify: (message, notifyType) => emit({ method: 'notify', message, notifyType }),
    onTerminalInput: () => () => {},
    setStatus: (key, text) => {
      const request = {
        type: 'extension_ui_request',
        id: crypto.randomUUID(),
        method: 'setStatus',
        statusKey: key,
        statusText: text,
      } satisfies RpcExtensionUIRequest
      if (text === undefined)
        statuses.delete(key)
      else
        statuses.set(key, request)
      publish(request)
      onStateChange()
    },
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget,
    setFooter: () => {},
    setHeader: () => {},
    setTitle: title => emit({ method: 'setTitle', title }),
    custom: async <T>() => undefined as T,
    pasteToEditor: text => emit({ method: 'set_editor_text', text }),
    setEditorText: text => emit({ method: 'set_editor_text', text }),
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return plainTheme
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Theme switching not supported in RPC mode' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  }

  return Object.assign(context, {
    respond(response: RpcExtensionUIResponse) {
      const dialog = pending.get(response.id)
      if (!dialog)
        return false
      dialog.settle(response)
      return true
    },
    cancelPending() {
      for (const dialog of [...pending.values()])
        dialog.settle()
    },
    reset() {
      for (const dialog of [...pending.values()])
        dialog.settle()
      statuses.clear()
      widgets.clear()
      onStateChange()
    },
    snapshot() {
      return [
        ...[...pending.values()].map(dialog => dialog.request),
        ...statuses.values(),
        ...widgets.values(),
      ]
    },
    hasPendingDialogs() {
      return pending.size > 0
    },
  })
}
