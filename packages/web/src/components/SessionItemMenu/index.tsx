import type { ForkPoint, SessionInfoLite } from '@piflow/protocol'
import { Download, ExternalLink, GitFork, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePresence } from '../../motion'
import { deleteSession, fetchForkPoints, forkSession } from '../../session/actions'
import { sessionUrl } from '../../session/api'
import { setSidebarOpen } from '../../session/store'
import Dialog from '../Dialog'
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
    <span ref={rootRef} className={`pf-relative ${className ?? ''}`} data-open={menuOpen || menu.mounted || undefined}>
      <IconButton
        label={`会话操作：${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}
      >
        <MoreHorizontal />
      </IconButton>
      {menu.mounted
        ? (
            <span className={`${styles.menu} pf-absolute pf-z-30 pf-right-0 pf-min-w-[136px] pf-p-[4px] pf-border pf-border-solid pf-border-line pf-rounded-[6px] pf-bg-raise t-dropdown ${menu.className}`} data-origin="top-right" role="menu" aria-label="会话操作">
              <button
                role="menuitem"
                className={`${styles.menuItem} pf-flex pf-items-center pf-gap-[8px] pf-rounded-[4px] pf-p-[6px_8px] pf-text-[0.78rem] pf-text-left`}
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
                className={`${styles.menuItem} pf-flex pf-items-center pf-gap-[8px] pf-rounded-[4px] pf-p-[6px_8px] pf-text-[0.78rem] pf-text-left`}
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
              <a role="menuitem" className={`${styles.menuItem} pf-flex pf-items-center pf-gap-[8px] pf-rounded-[4px] pf-p-[6px_8px] pf-text-[0.78rem] pf-text-left`} href={`${sessionUrl(session.path, 'export')}?inline=1`} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
                <ExternalLink />
                在新标签页预览
              </a>
              <a role="menuitem" className={`${styles.menuItem} pf-flex pf-items-center pf-gap-[8px] pf-rounded-[4px] pf-p-[6px_8px] pf-text-[0.78rem] pf-text-left`} href={sessionUrl(session.path, 'export')} onClick={() => setMenuOpen(false)}>
                <Download />
                下载 HTML
              </a>
              <button
                role="menuitem"
                className={`${styles.menuItem} pf-flex pf-items-center pf-gap-[8px] pf-rounded-[4px] pf-p-[6px_8px] pf-text-[0.78rem] pf-text-left ${styles.danger}`}
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

export function ForkDialog({ session, label, onClose }: { session: SessionInfoLite, label: string, onClose: () => void }) {
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
    <Dialog title="选择分叉点" eyebrow="分叉" width={440} maxHeight={560} onClose={onClose}>
      <p className="pf-m-0 pf-p-[14px_20px_4px] pf-text-faint pf-text-[0.76rem] pf-leading-[1.55]">
        从「
        {label}
        」的这条消息创建新会话，新会话只包含它及之前的内容。
      </p>
      <div className="pf-min-h-[72px] pf-overflow-y-auto pf-p-[10px_8px_12px]">
        {error ? <p className="pf-m-[8px_12px_0] pf-text-danger pf-text-[0.76rem]">{error}</p> : null}
        {points === null && !error ? <p className="pf-m-0 pf-p-[22px_12px] pf-text-faint pf-text-[0.8rem] pf-text-center">读取消息中…</p> : null}
        {points?.length === 0 ? <p className="pf-m-0 pf-p-[22px_12px] pf-text-faint pf-text-[0.8rem] pf-text-center">没有可分叉的用户消息</p> : null}
        {points?.map(point => (
          <button key={point.entryId} className={`${styles.point} pf-block pf-w-full pf-overflow-hidden pf-rounded-[5px] pf-p-[8px_12px] pf-text-[0.8rem] pf-text-left pf-text-ellipsis pf-whitespace-nowrap`} disabled={busy} onClick={() => void pickForkPoint(point)}>
            {point.text}
          </button>
        ))}
      </div>
    </Dialog>
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
    <Dialog title="删除会话？" eyebrow="删除" width={440} maxHeight={560} onClose={onClose} describedBy="delete-dialog-desc" role="alertdialog">
      {close => (
        <>
          <p className="pf-m-0 pf-p-[14px_20px_4px] pf-text-faint pf-text-[0.76rem] pf-leading-[1.55]" id="delete-dialog-desc">
            将永久删除「
            {label}
            」，此操作不可恢复。
          </p>
          {error ? <p className="pf-m-[8px_12px_0] pf-text-danger pf-text-[0.76rem]">{error}</p> : null}
          <footer className="pf-flex pf-justify-end pf-gap-[8px] pf-p-[6px_20px_18px]">
            <button className={`${styles.cancel} pf-p-[7px_12px] pf-text-[0.8rem]`} onClick={close}>取消</button>
            <button className={`${styles.confirmDanger} pf-p-[7px_12px] pf-text-[0.8rem] pf-border pf-border-solid pf-border-danger pf-text-danger`} disabled={busy} onClick={() => void confirm()}>删除</button>
          </footer>
        </>
      )}
    </Dialog>
  )
}
