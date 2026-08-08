import styles from './styles.module.css'

interface ViewSwitchProps {
  active: 'chat' | 'flow'
  onChange: (view: 'chat' | 'flow') => void
}

export default function ViewSwitch({ active, onChange }: ViewSwitchProps) {
  return (
    <div className={styles.switcher} aria-label="工作区视图">
      <button className={active === 'chat' ? styles.active : ''} aria-pressed={active === 'chat'} onClick={() => onChange('chat')}>聊天</button>
      <button className={`${styles.flow} ${active === 'flow' ? styles.active : ''}`} aria-pressed={active === 'flow'} onClick={() => onChange('flow')}>Flow</button>
    </div>
  )
}
