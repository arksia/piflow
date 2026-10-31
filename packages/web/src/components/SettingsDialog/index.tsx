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
    <ModalFrame backdropClass="pf-dialog-backdrop pf-p-[20px]" dialogClass={`${styles.dialog} pf-dialog-surface`} onClose={onClose} labelledBy="settings-title">
      {close => (
        <>
          <header className={`${styles.header} pf-flex pf-items-center pf-justify-between pf-gap-[16px] pf-p-[16px_18px]`}>
            <h2 id="settings-title">设置</h2>
            <IconButton label="关闭" onClick={close}><X /></IconButton>
          </header>
          <div className="pf-flex pf-flex-col pf-gap-[8px] pf-p-[14px]">
            <div className="pf-flex pf-items-center pf-justify-between pf-gap-[12px] pf-p-[8px_8px_8px_10px] pf-text-body pf-text-[0.84rem]">
              <span>外观</span>
              <div className={`${styles.theme} pf-flex`} role="group" aria-label="外观">
                <button type="button" aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && onToggleTheme()}>深色</button>
                <button type="button" aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && onToggleTheme()}>浅色</button>
              </div>
            </div>
            <button type="button" className={`${styles.action} pf-w-full pf-p-[8px_10px] pf-rounded-[4px] pf-text-[0.84rem] pf-text-left`} disabled={!connected} onClick={onOpenProviders}>Provider 与凭证</button>
            <button type="button" className={`${styles.action} pf-w-full pf-p-[8px_10px] pf-rounded-[4px] pf-text-[0.84rem] pf-text-left`} disabled={!connected} onClick={onOpenExtensions}>扩展管理</button>
          </div>
        </>
      )}
    </ModalFrame>
  )
}
