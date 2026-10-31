import type { ExtensionSourceInfo } from '@piflow/protocol'
import type { FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchExtensions, installExtension, removeExtension } from '../../session/actions'
import Button from '../Button'
import Dialog from '../Dialog'
import IconButton from '../IconButton'
import styles from './styles.module.css'

interface Props {
  onClose: () => void
}

function scopeLabel(scope: ExtensionSourceInfo['scope']) {
  return scope === 'project' ? '项目' : '全局'
}

export default function ExtensionManagerDialog({ onClose }: Props) {
  const [extensions, setExtensions] = useState<ExtensionSourceInfo[] | null>(null)
  const [source, setSource] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void refresh()
  }, [])

  async function refresh() {
    setError(null)
    try {
      setExtensions(await fetchExtensions())
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取扩展列表')
    }
  }

  async function run(action: () => Promise<unknown>) {
    if (busy)
      return
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    }
    finally {
      setBusy(false)
    }
  }

  function submitInstall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = source.trim()
    if (!trimmed)
      return
    void run(async () => {
      await installExtension(trimmed, scope)
      setSource('')
    })
  }

  return (
    <Dialog initialFocus={inputRef} title="管理 pi 扩展" eyebrow="扩展" onClose={onClose}>

      <form className={`${styles.installForm} pf-flex pf-gap-[8px]`} onSubmit={submitInstall}>
        <select value={scope} aria-label="扩展范围" onChange={event => setScope(event.target.value as 'global' | 'project')}>
          <option value="global">全局</option>
          <option value="project">项目</option>
        </select>
        <input
          ref={inputRef}
          value={source}
          aria-label="扩展来源"
          placeholder="npm:@scope/pkg 或 git:https://…"
          onChange={event => setSource(event.target.value)}
        />
        <Button variant="primary" type="submit" disabled={busy || !source.trim()}>安装</Button>
      </form>

      <div className={`${styles.body} pf-min-h-[120px] pf-overflow-y-auto pf-p-[8px]`}>
        {extensions === null
          ? <p className={`${styles.message} pf-m-0 pf-p-[28px_12px] pf-text-[0.8rem] pf-text-center`}>读取扩展中…</p>
          : extensions.length === 0
            ? <p className={`${styles.message} pf-m-0 pf-p-[28px_12px] pf-text-[0.8rem] pf-text-center`}>尚未配置扩展</p>
            : extensions.map(extension => (
                <div key={`${extension.scope}:${extension.source}`} className={`${styles.row} pf-flex pf-items-center pf-gap-[10px] pf-rounded-[5px] pf-p-[8px_12px]`}>
                  <span className="pf-shrink-0 pf-border pf-border-solid pf-border-line pf-rounded-[4px] pf-p-[1px_6px] pf-text-muted pf-text-[0.68rem]">{scopeLabel(extension.scope)}</span>
                  <span className="pf-min-w-0 pf-flex-1 pf-overflow-hidden pf-text-mid pf-font-mono pf-text-[0.76rem] pf-text-ellipsis pf-whitespace-nowrap" title={extension.installedPath ?? extension.source}>
                    {extension.source}
                  </span>
                  <IconButton
                    size="compact"
                    label={`移除 ${extension.source}`}
                    disabled={busy}
                    onClick={() => void run(() => removeExtension(extension.source, extension.scope === 'project' ? 'project' : 'global'))}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
        {error ? <p className={`${styles.error} pf-m-0 pf-p-[28px_12px] pf-text-[0.8rem] pf-text-center`}>{error}</p> : null}
      </div>

      <footer className={`${styles.footer} pf-flex pf-justify-between pf-gap-[16px] pf-p-[18px_20px]`}>
        <span className="pf-text-faint pf-text-[0.72rem]">变更后所有空闲会话会自动重载扩展</span>
      </footer>
    </Dialog>
  )
}
