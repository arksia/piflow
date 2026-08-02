import type { FormEvent } from 'react'
import type { DirectoryListing } from '../../session/types'
import { useEffect, useRef, useState } from 'react'
import { newSessionIn, requestDirectories } from '../../session/actions'
import styles from './styles.module.css'

interface Props {
  initialPath: string
  onClose: () => void
  onCreated: () => void
}

export default function NewSessionDialog({ initialPath, onClose, onCreated }: Props) {
  const [path, setPath] = useState(initialPath)
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void browse(initialPath)
  }, [initialPath])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function browse(nextPath: string) {
    setLoading(true)
    setError(null)
    try {
      const nextListing = await requestDirectories(nextPath)
      setListing(nextListing)
      setPath(nextListing.path)
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取目录')
    }
    finally {
      setLoading(false)
    }
  }

  async function create() {
    if (!listing || creating)
      return
    setCreating(true)
    setError(null)
    try {
      await newSessionIn(listing.path)
      onCreated()
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法创建会话')
      setCreating(false)
    }
  }

  function submitPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (path.trim())
      void browse(path.trim())
  }

  return (
    <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="new-session-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>新会话</p>
            <h2 id="new-session-title">选择项目文件夹</h2>
          </div>
          <button className={styles.close} title="关闭" aria-label="关闭" onClick={onClose}>×</button>
        </header>

        <form className={styles.pathForm} onSubmit={submitPath}>
          <input
            ref={inputRef}
            value={path}
            aria-label="项目文件夹路径"
            onChange={event => setPath(event.target.value)}
          />
          <button className={styles.go} type="submit" disabled={loading}>前往</button>
        </form>

        <div className={styles.location} title={listing?.path ?? path}>
          <button
            className={styles.parent}
            disabled={!listing?.parent || loading}
            title="返回上级目录"
            aria-label="返回上级目录"
            onClick={() => listing?.parent && void browse(listing.parent)}
          >
            ↑
          </button>
          <span>{listing?.path ?? path}</span>
        </div>

        <div className={styles.body}>
          {loading
            ? <p className={styles.message}>读取目录中…</p>
            : error
              ? <p className={styles.error}>{error}</p>
              : listing?.directories.length
                ? listing.directories.map(directory => (
                    <button
                      key={directory.path}
                      className={styles.directory}
                      onClick={() => void browse(directory.path)}
                    >
                      <span className={styles.folder}>/</span>
                      <span>{directory.name}</span>
                    </button>
                  ))
                : <p className={styles.message}>这里没有子文件夹</p>}
        </div>

        <footer className={styles.footer}>
          <span className={styles.hint}>会话将在选中的文件夹中创建</span>
          <button className={styles.create} disabled={!listing || loading || creating} onClick={() => void create()}>
            {creating ? '创建中…' : '在此创建'}
          </button>
        </footer>
      </section>
    </div>
  )
}
