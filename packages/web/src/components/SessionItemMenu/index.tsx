import type { ForkPoint, SessionInfoLite } from '@piflow/protocol'
import { Download, ExternalLink, GitFork, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ModalFrame, usePresence } from '../../motion'
import { deleteSession, fetchForkPoints, forkSession } from '../../session/actions'
import { sessionUrl } from '../../session/api'
import { setSidebarOpen } from '../../session/store'
import IconButton from '../IconButton'
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
  const menu = usePresence(menuOpen, '--dropdown-close-dur', 150)

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
    <span ref={rootRef} className={`${styles.root} ${className ?? ''}`} data-open={menuOpen || menu.mounted || undefined}>
      <IconButton
        size="compact"
        label={`会话操作：${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}
      >
        <MoreHorizontal />
      </IconButton>
      {menu.mounted
        ? (
            <span className={`${styles.menu} t-dropdown ${menu.className}`} data-origin="top-right" role="menu" aria-label="会话操作">
              <button
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  onRename()
                }}
              >
                <Pencil />
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
                <GitFork />
                从消息分叉…
              </button>
              <a role="menuitem" className={styles.menuItem} href={`${sessionUrl(session.path, 'export')}?inline=1`} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
                <ExternalLink />
                在新标签页预览
              </a>
              <a role="menuitem" className={styles.menuItem} href={sessionUrl(session.path, 'export')} onClick={() => setMenuOpen(false)}>
                <Download />
                下载 HTML
              </a>
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
                <Trash2 />
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

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

function ForkDialog({ session, label, onClose }: { session: SessionInfoLite, label: string, onClose: () => void }) {
  const [points, setPoints] = useState<ForkPoint[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <ModalFrame backdropClass={styles.backdrop} dialogClass={styles.dialog} onClose={onClose} labelledBy="fork-dialog-title">
      {close => (
        <>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>分叉</p>
              <h2 id="fork-dialog-title">选择分叉点</h2>
            </div>
            <IconButton label="关闭" onClick={close}><X /></IconButton>
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
        </>
      )}
    </ModalFrame>
  )
}

function DeleteDialog({ path, label, onClose }: { path: string, label: string, onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <ModalFrame backdropClass={styles.backdrop} dialogClass={styles.dialog} onClose={onClose} labelledBy="delete-dialog-title" describedBy="delete-dialog-desc" role="alertdialog">
      {close => (
        <>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>删除</p>
              <h2 id="delete-dialog-title">删除会话？</h2>
            </div>
            <IconButton label="关闭" onClick={close}><X /></IconButton>
          </header>
          <p className={styles.hint} id="delete-dialog-desc">
            将永久删除「
            {label}
            」，此操作不可恢复。
          </p>
          {error ? <p className={styles.error}>{error}</p> : null}
          <footer className={styles.actions}>
            <button className={styles.cancel} onClick={close}>取消</button>
            <button className={styles.confirmDanger} disabled={busy} onClick={() => void confirm()}>删除</button>
          </footer>
        </>
      )}
    </ModalFrame>
  )
}
