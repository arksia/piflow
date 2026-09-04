import type { ExtensionSourceInfo } from '@piflow/protocol'
import type { FormEvent } from 'react'
import { Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchExtensions, installExtension, removeExtension } from '../../session/actions'
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

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
    <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="extensions-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>扩展</p>
            <h2 id="extensions-title">管理 pi 扩展</h2>
          </div>
          <button className={styles.close} title="关闭" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>

        <form className={styles.installForm} onSubmit={submitInstall}>
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
          <button className={styles.install} type="submit" disabled={busy || !source.trim()}>安装</button>
        </form>

        <div className={styles.body}>
          {extensions === null
            ? <p className={styles.message}>读取扩展中…</p>
            : extensions.length === 0
              ? <p className={styles.message}>尚未配置扩展</p>
              : extensions.map(extension => (
                  <div key={`${extension.scope}:${extension.source}`} className={styles.row}>
                    <span className={styles.scope}>{scopeLabel(extension.scope)}</span>
                    <span className={styles.source} title={extension.installedPath ?? extension.source}>
                      {extension.source}
                    </span>
                    <button
                      className={styles.remove}
                      title={`移除 ${extension.source}`}
                      aria-label={`移除 ${extension.source}`}
                      disabled={busy}
                      onClick={() => void run(() => removeExtension(extension.source, extension.scope === 'project' ? 'project' : 'global'))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>

        <footer className={styles.footer}>
          <span className={styles.hint}>变更后所有空闲会话会自动重载扩展</span>
        </footer>
      </section>
    </div>
  )
}
