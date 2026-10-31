import type { DirectoryListing } from '@piflow/protocol'
import type { FormEvent } from 'react'
import { Folder, FolderUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { requestDirectories, selectProjectForNewChat } from '../../session/actions'
import Button from '../Button'
import Dialog from '../Dialog'
import IconButton from '../IconButton'
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
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void browse(initialPath)
  }, [initialPath])

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

  function create() {
    if (!listing)
      return
    selectProjectForNewChat(listing.path)
    onCreated()
  }

  function submitPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (path.trim())
      void browse(path.trim())
  }

  return (
    <Dialog initialFocus={inputRef} title="选择项目文件夹" eyebrow="新会话" responsive onClose={onClose}>

      <form className={`${styles.pathForm} pf-flex pf-gap-[8px]`} onSubmit={submitPath}>
        <input
          ref={inputRef}
          value={path}
          aria-label="项目文件夹路径"
          onChange={event => setPath(event.target.value)}
        />
        <Button type="submit" disabled={loading}>前往</Button>
      </form>

      <div className={`${styles.location} pf-flex pf-items-center pf-gap-[8px] pf-min-w-0 pf-text-faint pf-font-mono pf-text-[0.7rem]`} title={listing?.path ?? path}>
        <IconButton
          size="compact"
          variant="outline"
          label="返回上级目录"
          disabled={!listing?.parent || loading}
          onClick={() => listing?.parent && void browse(listing.parent)}
        >
          <FolderUp />
        </IconButton>
        <span>{listing?.path ?? path}</span>
      </div>

      <div className={`${styles.body} pf-min-h-[180px] pf-overflow-y-auto pf-p-[8px]`}>
        {loading
          ? <p className={`${styles.message} pf-m-0 pf-p-[28px_12px] pf-text-[0.8rem] pf-text-center`}>读取目录中…</p>
          : error
            ? <p className={`${styles.error} pf-m-0 pf-p-[28px_12px] pf-text-[0.8rem] pf-text-center`}>{error}</p>
            : listing?.directories.length
              ? listing.directories.map(directory => (
                  <button
                    key={directory.path}
                    className={`${styles.directory} pf-flex pf-items-center pf-gap-[10px] pf-w-full pf-rounded-[5px] pf-p-[9px_12px] pf-text-left pf-text-mid`}
                    onClick={() => void browse(directory.path)}
                  >
                    <span className="pf-grid pf-w-[18px] pf-place-items-center pf-text-signal"><Folder size={12} /></span>
                    <span>{directory.name}</span>
                  </button>
                ))
              : <p className={`${styles.message} pf-m-0 pf-p-[28px_12px] pf-text-[0.8rem] pf-text-center`}>这里没有子文件夹</p>}
      </div>

      <footer className={`${styles.footer} pf-flex pf-justify-between pf-gap-[16px]`}>
        <span className="pf-text-faint pf-text-[0.72rem]">发送第一条消息后创建会话</span>
        <Button variant="primary" disabled={!listing || loading} onClick={create}>
          在此开始
        </Button>
      </footer>
    </Dialog>
  )
}
