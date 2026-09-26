import { X } from 'lucide-react'
import { ModalFrame } from '../../motion'
import IconButton from '../IconButton'
import styles from './styles.module.css'

interface Props {
  theme: 'dark' | 'light'
  connected: boolean
  onToggleTheme: () => void
  onOpenProviders: () => void
  onOpenExtensions: () => void
  onClose: () => void
}

export default function SettingsDialog({ theme, connected, onToggleTheme, onOpenProviders, onOpenExtensions, onClose }: Props) {
  return (
    <ModalFrame backdropClass={styles.backdrop} dialogClass={styles.dialog} onClose={onClose} labelledBy="settings-title">
      {close => (
        <>
          <header className={styles.header}>
            <h2 id="settings-title">设置</h2>
            <IconButton label="关闭" onClick={close}><X /></IconButton>
          </header>
          <div className={styles.body}>
            <div className={styles.row}>
              <span>外观</span>
              <div className={styles.theme} role="group" aria-label="外观">
                <button type="button" aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && onToggleTheme()}>深色</button>
                <button type="button" aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && onToggleTheme()}>浅色</button>
              </div>
            </div>
            <button type="button" className={styles.action} disabled={!connected} onClick={onOpenProviders}>Provider 与凭证</button>
            <button type="button" className={styles.action} disabled={!connected} onClick={onOpenExtensions}>扩展管理</button>
          </div>
        </>
      )}
    </ModalFrame>
  )
}
