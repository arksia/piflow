import type { ForkPoint, SessionInfoLite } from '@piflow/protocol'
import { GitFork, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { deleteSession, fetchForkPoints, forkSession } from '../../session/actions'
import { setSidebarOpen } from '../../session/store'
import styles from './styles.module.css'

interface Props {
  session: SessionInfoLite
  label: string
  streaming: boolean
  className?: string
  onRename: () => void
}

export default function SessionItemMenu({ session, label, streaming, className, onRename }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [forkOpen, setForkOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!menuOpen)
      return
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target))
        setMenuOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape')
        setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <span ref={rootRef} className={`${styles.root} ${className ?? ''}`} data-open={menuOpen || undefined}>
      <button
        className={styles.trigger}
        title="会话操作"
        aria-label={`会话操作：${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}
      >
        <MoreHorizontal size={13} />
      </button>
      {menuOpen
        ? (
            <span className={styles.menu} role="menu" aria-label="会话操作">
              <button
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  onRename()
                }}
              >
                <Pencil size={13} />
                重命名
              </button>
              <button
                role="menuitem"
                className={styles.menuItem}
                disabled={session.messageCount === 0}
                title={session.messageCount === 0 ? '没有可分叉的用户消息' : undefined}
                onClick={() => {
                  setMenuOpen(false)
                  setForkOpen(true)
                }}
              >
                <GitFork size={13} />
                从消息分叉…
              </button>
              <button
                role="menuitem"
                className={`${styles.menuItem} ${styles.danger}`}
                disabled={streaming}
                title={streaming ? '流式进行中，稍后再删' : undefined}
                onClick={() => {
                  setMenuOpen(false)
                  setDeleteOpen(true)
                }}
              >
                <Trash2 size={13} />
                删除
              </button>
            </span>
          )
        : null}
      {forkOpen ? <ForkDialog session={session} label={label} onClose={() => setForkOpen(false)} /> : null}
      {deleteOpen ? <DeleteDialog path={session.path} label={label} onClose={() => setDeleteOpen(false)} /> : null}
    </span>
  )
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

function ForkDialog({ session, label, onClose }: { session: SessionInfoLite, label: string, onClose: () => void }) {
  const [points, setPoints] = useState<ForkPoint[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEscape(onClose)

  useEffect(() => {
    let cancelled = false
    fetchForkPoints(session.path).then(
      (list) => {
        // Newest first — the usual fork target is a recent message.
        if (!cancelled)
          setPoints([...list].reverse())
      },
      (reason) => {
        if (!cancelled)
          setError(errorMessage(reason, '无法读取分叉点'))
      },
    )
    return () => {
      cancelled = true
    }
  }, [session.path])

  async function pickForkPoint(point: ForkPoint) {
    if (busy)
      return
    setBusy(true)
    setError(null)
    try {
      await forkSession(session.path, point.entryId)
      setSidebarOpen(false)
      onClose()
    }
    catch (reason) {
      setError(errorMessage(reason, '分叉失败'))
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="fork-dialog-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>分叉</p>
            <h2 id="fork-dialog-title">选择分叉点</h2>
          </div>
          <button className={styles.close} title="关闭" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <p className={styles.hint}>
          从「
          {label}
          」的这条消息创建新会话，新会话只包含它及之前的内容。
        </p>
        <div className={styles.body}>
          {error ? <p className={styles.error}>{error}</p> : null}
          {points === null && !error ? <p className={styles.message}>读取消息中…</p> : null}
          {points?.length === 0 ? <p className={styles.message}>没有可分叉的用户消息</p> : null}
          {points?.map(point => (
            <button key={point.entryId} className={styles.point} disabled={busy} onClick={() => void pickForkPoint(point)}>
              {point.text}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function DeleteDialog({ path, label, onClose }: { path: string, label: string, onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEscape(onClose)

  async function confirm() {
    if (busy)
      return
    setBusy(true)
    setError(null)
    try {
      await deleteSession(path)
      onClose()
    }
    catch (reason) {
      setError(errorMessage(reason, '删除失败'))
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-desc">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>删除</p>
            <h2 id="delete-dialog-title">删除会话？</h2>
          </div>
          <button className={styles.close} title="关闭" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <p className={styles.hint} id="delete-dialog-desc">
          将永久删除「
          {label}
          」，此操作不可恢复。
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
        <footer className={styles.actions}>
          <button className={styles.cancel} onClick={onClose}>取消</button>
          <button className={styles.confirmDanger} disabled={busy} onClick={() => void confirm()}>删除</button>
        </footer>
      </section>
    </div>
  )
}
