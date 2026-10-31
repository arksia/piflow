import type { RpcExtensionUIRequest } from '@earendil-works/pi-coding-agent'
import type { ExtensionUIResponseBody } from '@piflow/protocol'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { answerExtensionRequest, dismissExtensionNotice } from '../../session/actions'
import { useStore } from '../../session/use-store'
import Button from '../Button'
import Dialog from '../Dialog'
import IconButton from '../IconButton'
import TextInput from '../TextInput'
import styles from './styles.module.css'

type DialogRequest = Extract<RpcExtensionUIRequest, { method: 'select' | 'confirm' | 'input' | 'editor' }>
type TextDialogRequest = Extract<DialogRequest, { method: 'input' | 'editor' }>

function answer(session: string, request: DialogRequest, response: { cancelled?: boolean, value?: string, confirmed?: boolean }) {
  const frame: ExtensionUIResponseBody = response.cancelled
    ? { type: 'extension_ui_response', id: request.id, session, cancelled: true }
    : response.confirmed !== undefined
      ? { type: 'extension_ui_response', id: request.id, session, confirmed: response.confirmed }
      : { type: 'extension_ui_response', id: request.id, session, value: response.value ?? '' }
  void answerExtensionRequest(frame)
    .catch((error: unknown) => console.error('[piflow]', error))
}

function SelectDialog({ session, request }: { session: string, request: Extract<DialogRequest, { method: 'select' }> }) {
  return (
    <>
      <div className="pf-flex pf-flex-col pf-gap-[6px] pf-overflow-y-auto">
        {(request.options ?? []).map(option => (
          <button key={option} className={`${styles.option} pf-p-[9px_12px] pf-bg-bg pf-text-[0.8rem] pf-text-left`} onClick={() => answer(session, request, { value: option })}>
            {option}
          </button>
        ))}
      </div>
      <footer className="pf-flex pf-justify-end pf-gap-[8px]">
        <Button onClick={() => answer(session, request, { cancelled: true })}>取消</Button>
      </footer>
    </>
  )
}

function ConfirmDialog({ session, request }: { session: string, request: Extract<DialogRequest, { method: 'confirm' }> }) {
  return (
    <>
      {request.message ? <p className="pf-m-0 pf-text-mid pf-text-[0.82rem] pf-leading-[1.6] pf-whitespace-pre-wrap">{request.message}</p> : null}
      <footer className="pf-flex pf-justify-end pf-gap-[8px]">
        <Button onClick={() => answer(session, request, { cancelled: true })}>取消</Button>
        <Button variant="primary" onClick={() => answer(session, request, { confirmed: true })}>确认</Button>
      </footer>
    </>
  )
}

function InputDialog({ session, request }: { session: string, request: TextDialogRequest }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const [value, setValue] = useState(request.method === 'editor' ? request.prefill ?? '' : '')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    answer(session, request, { value })
  }

  return (
    <>
      <form onSubmit={submit}>
        <TextInput
          className="pf-w-full"
          ref={inputRef}
          value={value}
          aria-label={request.title ?? '输入'}
          placeholder={request.method === 'input' ? request.placeholder : undefined}
          onChange={event => setValue(event.target.value)}
        />
      </form>
      <footer className="pf-flex pf-justify-end pf-gap-[8px]">
        <Button onClick={() => answer(session, request, { cancelled: true })}>取消</Button>
        <Button variant="primary" onClick={() => answer(session, request, { value })}>提交</Button>
      </footer>
    </>
  )
}

export default function ExtensionDialog() {
  const store = useStore()
  const view = store.activeKey ? store.views[store.activeKey] : undefined
  const request = view?.extensionRequests[0]
  const pending = request && isDialogRequest(request) ? request : undefined

  return (
    <>
      {pending && store.activeKey
        ? (
            <Dialog key={pending.id} title={pending.title ?? '扩展请求'} width={440} maxHeight={560} onClose={() => answer(store.activeKey!, pending, { cancelled: true })}>
              <div className="pf-flex pf-flex-col pf-overflow-y-auto pf-p-[18px_20px] pf-gap-[12px]">
                {pending.method === 'select' ? <SelectDialog session={store.activeKey} request={pending} /> : null}
                {pending.method === 'confirm' ? <ConfirmDialog session={store.activeKey} request={pending} /> : null}
                {pending.method === 'input' || pending.method === 'editor'
                  ? <InputDialog session={store.activeKey} request={pending} />
                  : null}
              </div>
            </Dialog>
          )
        : null}
      {store.extensionNotices.length > 0
        ? (
            <div className={`${styles.notices} pf-fixed pf-z-45 pf-right-[16px] pf-bottom-[16px] pf-flex pf-flex-col pf-gap-[8px]`} role="status">
              {store.extensionNotices.map(notice => (
                <div key={notice.request.id} className={`${styles.notice} pf-flex pf-items-start pf-gap-[10px] pf-p-[10px_12px] pf-bg-raise ${styles[notice.request.notifyType ?? 'info']}`}>
                  <span className="pf-min-w-0 pf-flex-1 pf-text-body pf-text-[0.78rem] pf-leading-[1.5] pf-whitespace-pre-wrap">{notice.request.message ?? ''}</span>
                  <IconButton
                    size="compact"
                    label="知道了"
                    onClick={() => dismissExtensionNotice(notice.request.id)}
                  >
                    <X />
                  </IconButton>
                </div>
              ))}
            </div>
          )
        : null}
    </>
  )
}

function isDialogRequest(request: RpcExtensionUIRequest): request is DialogRequest {
  return request.method === 'select'
    || request.method === 'confirm'
    || request.method === 'input'
    || request.method === 'editor'
}
