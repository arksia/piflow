import { PanelLeft } from 'lucide-react'
import IconButton from '../IconButton'
import styles from './styles.module.css'

export default function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean, onToggle: () => void }) {
  return (
    <span className={`${styles.slot} pf-flex-none pf-items-center pf-overflow-clip`} data-collapsed={collapsed || undefined} inert={!collapsed}>
      <IconButton label="展开会话列表" onClick={onToggle}>
        <PanelLeft />
      </IconButton>
    </span>
  )
}
