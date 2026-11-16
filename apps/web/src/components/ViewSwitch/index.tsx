import { GitFork, MessagesSquare } from 'lucide-react'
import styles from './styles.module.css'

interface ViewSwitchProps {
  active: 'chat' | 'flow'
  onChange: (view: 'chat' | 'flow') => void
}

const VIEWS = [
  { key: 'chat' as const, label: '会话', icon: MessagesSquare },
  { key: 'flow' as const, label: 'Flow 画布', icon: GitFork },
]

export default function ViewSwitch({ active, onChange }: ViewSwitchProps) {
  return (
    <nav className={`${styles.views} pf-relative pf-gap-[2px] pf-p-[3px] pf-rounded-[8px] pf-bg-press`} aria-label="工作区视图" data-active={active}>
      <span className={`${styles.slider} pf-row-start-1 pf-col-start-1 pf-rounded-[5px] pf-bg-canvas pf-[box-shadow:var(--shadow-control)] pf-pointer-events-none`} aria-hidden="true" />
      {VIEWS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={[
            'pf-text-muted hover:pf-text-ink aria-[current=page]:pf-text-ink pf-relative pf-z-1 pf-flex pf-items-center',
            'pf-justify-center pf-gap-[7px] pf-min-h-[30px] pf-p-[0_10px] pf-rounded-[5px] pf-text-ui pf-font-medium',
            `pf-whitespace-nowrap pf-row-start-1 ${key === 'chat' ? 'pf-col-start-1' : 'pf-col-start-2'}`,
          ].join(' ')}
          aria-current={active === key ? 'page' : undefined}
          onClick={() => onChange(key)}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  )
}
