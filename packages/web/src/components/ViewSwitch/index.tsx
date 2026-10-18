import { ChevronDown } from 'lucide-react'
import Dropdown from '../Dropdown'
import styles from './styles.module.css'

interface ViewSwitchProps {
  active: 'chat' | 'flow'
  onChange: (view: 'chat' | 'flow') => void
}

const VIEWS = [
  { key: 'chat' as const, label: '会话' },
  { key: 'flow' as const, label: '画布' },
]

export default function ViewSwitch({ active, onChange }: ViewSwitchProps) {
  const label = VIEWS.find(view => view.key === active)?.label ?? '会话'
  return (
    <Dropdown
      placement="bottomLeft"
      minWidth={0}
      menu={{
        items: VIEWS.map(view => ({
          key: view.key,
          label: view.label,
          selected: view.key === active,
          onClick: () => onChange(view.key),
        })),
      }}
    >
      <button type="button" className={styles.trigger} aria-label={`会话和画布，当前${label}`}>
        {label}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </Dropdown>
  )
}
