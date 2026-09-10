import type { SessionTreeNode } from '@earendil-works/pi-coding-agent'
import { GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchSessionTree, navigateSessionTree } from '../../session/actions'
import styles from './styles.module.css'

export default function BranchNavigator({ path }: { path: string }) {
  const [tree, setTree] = useState<SessionTreeNode[] | null>(null)
  const [leafId, setLeafId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchSessionTree(path).then((result) => {
      if (!cancelled) {
        setTree(result.tree)
        setLeafId(result.leafId)
      }
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [path])

  if (!tree?.length)
    return null

  async function select(id: string) {
    await navigateSessionTree(path, id)
    setLeafId(id)
  }

  return (
    <div className={styles.root}>
      <button className={styles.toggle} title="切换会话分支" aria-label="切换会话分支" onClick={() => setOpen(value => !value)}>
        <GitBranch size={14} />
      </button>
      {open ? <div className={styles.menu} role="menu">{tree.map(node => <BranchNode key={node.entry.id} node={node} leafId={leafId} onSelect={select} />)}</div> : null}
    </div>
  )
}

function BranchNode({ node, leafId, onSelect }: { node: SessionTreeNode, leafId: string | null, onSelect: (id: string) => Promise<void> }) {
  const label = node.label || node.entry.id
  return (
    <div>
      <button className={`${styles.node} ${leafId === node.entry.id ? styles.active : ''}`} role="menuitem" onClick={() => void onSelect(node.entry.id)}>{label}</button>
      {node.children.map(child => <BranchNode key={child.entry.id} node={child} leafId={leafId} onSelect={onSelect} />)}
    </div>
  )
}
