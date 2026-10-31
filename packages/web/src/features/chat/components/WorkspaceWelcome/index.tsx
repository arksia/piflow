import { ArrowUpRight, FileSearch, GitCompareArrows, ListTodo, ScanSearch } from 'lucide-react'
import { shortenPath } from '../../../../path'
import styles from './styles.module.css'

const STARTERS = [
  { title: '探索代码库', description: '了解项目结构与关键模块', prompt: '探索这个代码库', icon: ScanSearch },
  { title: '审查改动', description: '检查当前变更与潜在问题', prompt: '回顾我的改动', icon: GitCompareArrows },
  { title: '排查问题', description: '描述现象，一起定位原因', prompt: '帮我排查一个 bug：', icon: FileSearch },
  { title: '规划功能', description: '把想法拆成可执行的步骤', prompt: '帮我规划一个功能：', icon: ListTodo },
]

export default function WorkspaceWelcome({ cwd, onChoose }: { cwd: string, onChoose: (prompt: string) => void }) {
  return (
    <section className={`${styles.welcome} pf-shrink-0`} aria-labelledby="workspace-welcome-title">
      <h1 id="workspace-welcome-title">从一个想法，开始工作。</h1>
      <p className="pf-m-0 pf-text-muted pf-text-ui">描述任务，让 pi 和你一起推进项目。</p>
      {cwd
        ? (
            <div className={`${styles.project} pf-flex pf-items-center pf-gap-[12px] pf-m-[24px_0_12px] pf-pb-[12px] pf-text-muted`} title={cwd}>
              <span>当前项目</span>
              <code>{shortenPath(cwd)}</code>
            </div>
          )
        : null}
      <div className={`${styles.starters} pf-grid pf-mt-[12px]`}>
        {STARTERS.map(({ title, description, prompt, icon: Icon }) => (
          <button key={title} type="button" className={`${styles.starter} pf-items-center pf-gap-[12px] pf-min-w-0 pf-p-[12px] pf-rounded-control pf-text-left`} onClick={() => onChoose(prompt)}>
            <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}
