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
    <nav className={styles.views} aria-label="工作区视图">
      {VIEWS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={styles.view}
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
