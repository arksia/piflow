import type { RpcExtensionUIRequest } from '@earendil-works/pi-coding-agent'
import type { ExtensionUIResponseBody } from '@piflow/protocol'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { answerExtensionRequest, dismissExtensionNotice } from '../../session/actions'
import { useStore } from '../../session/use-store'
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
      <h2 className={styles.title}>{request.title ?? '选择一项'}</h2>
      <div className={styles.options}>
        {(request.options ?? []).map(option => (
          <button key={option} className={styles.option} onClick={() => answer(session, request, { value: option })}>
            {option}
          </button>
        ))}
      </div>
      <footer className={styles.actions}>
        <button className={styles.cancel} onClick={() => answer(session, request, { cancelled: true })}>取消</button>
      </footer>
    </>
  )
}

function ConfirmDialog({ session, request }: { session: string, request: Extract<DialogRequest, { method: 'confirm' }> }) {
  return (
    <>
      <h2 className={styles.title}>{request.title ?? '确认'}</h2>
      {request.message ? <p className={styles.message}>{request.message}</p> : null}
      <footer className={styles.actions}>
        <button className={styles.cancel} onClick={() => answer(session, request, { cancelled: true })}>取消</button>
        <button className={styles.primary} onClick={() => answer(session, request, { confirmed: true })}>确认</button>
      </footer>
    </>
  )
}

function InputDialog({ session, request }: { session: string, request: TextDialogRequest }) {
  const [value, setValue] = useState(request.method === 'editor' ? request.prefill ?? '' : '')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    answer(session, request, { value })
  }

  return (
    <>
      <h2 className={styles.title}>{request.title ?? '输入'}</h2>
      <form className={styles.inputForm} onSubmit={submit}>
        <input
          autoFocus
          value={value}
          aria-label={request.title ?? '输入'}
          placeholder={request.method === 'input' ? request.placeholder : undefined}
          onChange={event => setValue(event.target.value)}
        />
      </form>
      <footer className={styles.actions}>
        <button className={styles.cancel} onClick={() => answer(session, request, { cancelled: true })}>取消</button>
        <button className={styles.primary} onClick={() => answer(session, request, { value })}>提交</button>
      </footer>
    </>
  )
}

export default function ExtensionDialog() {
  const store = useStore()
  const view = store.activeKey ? store.views[store.activeKey] : undefined
  const request = view?.extensionRequests[0]
  const pending = request && isDialogRequest(request) ? request : undefined

  useEffect(() => {
    if (!pending || !store.activeKey)
      return
    const session = store.activeKey
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && pending)
        answer(session, pending, { cancelled: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, store.activeKey])

  return (
    <>
      {pending && store.activeKey
        ? (
            <div className={styles.backdrop}>
              <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={pending.title ?? '扩展请求'}>
                {pending.method === 'select' ? <SelectDialog session={store.activeKey} request={pending} /> : null}
                {pending.method === 'confirm' ? <ConfirmDialog session={store.activeKey} request={pending} /> : null}
                {pending.method === 'input' || pending.method === 'editor'
                  ? <InputDialog session={store.activeKey} request={pending} />
                  : null}
              </section>
            </div>
          )
        : null}
      {store.extensionNotices.length > 0
        ? (
            <div className={styles.notices} role="status">
              {store.extensionNotices.map(notice => (
                <div key={notice.request.id} className={`${styles.notice} ${styles[notice.request.notifyType ?? 'info']}`}>
                  <span className={styles.noticeText}>{notice.request.message ?? ''}</span>
                  <button
                    className={styles.dismiss}
                    title="知道了"
                    aria-label="知道了"
                    onClick={() => dismissExtensionNotice(notice.request.id)}
                  >
                    <X size={13} />
                  </button>
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
