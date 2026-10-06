import type { GitBranchesResponse } from '@piflow/protocol'
import { ChevronDown, GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { checkoutGitBranch, fetchGitBranches } from '../../session/actions'
import Dropdown from '../Dropdown'
import styles from './styles.module.css'

export default function BranchNavigator({ cwd }: { cwd: string }) {
  const [info, setInfo] = useState<GitBranchesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchGitBranches(cwd).then((result) => {
      if (!cancelled)
        setInfo(result)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [cwd])

  if (!info?.current)
    return null

  async function select(branch: string) {
    setError(null)
    try {
      setInfo(await checkoutGitBranch(cwd, branch))
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '切换失败')
    }
  }

  return (
    <Dropdown
      placement="topLeft"
      maxWidth={300}
      menu={{
        items: info.branches.map(branch => ({
          key: branch,
          label: branch,
          selected: branch === info.current,
          onClick: () => {
            if (branch !== info.current)
              void select(branch)
          },
        })),
      }}
    >
      <button
        type="button"
        className={styles.toggle}
        title={error ?? '切换 Git 分支'}
        aria-label={`切换 Git 分支，当前 ${info.current}`}
      >
        <GitBranch />
        <span className={styles.label}>{info.current}</span>
        <ChevronDown className={styles.chevron} />
      </button>
    </Dropdown>
  )
}
