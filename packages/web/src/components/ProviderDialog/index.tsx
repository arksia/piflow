import type { ProviderInfo } from '@piflow/protocol'
import { RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchProviders } from '../../session/actions'
import styles from './styles.module.css'

interface Props {
  onClose: () => void
}

const sourceLabels: Record<NonNullable<ProviderInfo['source']>, string> = {
  environment: '环境变量',
  fallback: '系统凭证',
  models_json_command: 'models.json 命令',
  models_json_key: 'models.json',
  runtime: '运行时',
  stored: '已保存',
}

function authLabel(provider: ProviderInfo) {
  if (provider.credentialType === 'oauth')
    return provider.oauthName ?? 'OAuth'
  if (provider.credentialType === 'api_key')
    return 'API key'
  if (provider.source)
    return sourceLabels[provider.source]
  return provider.authTypes.map(type => type === 'oauth' ? 'OAuth' : 'API key').join(' / ') || '外部配置'
}

export default function ProviderDialog({ onClose }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function refresh() {
    setError(null)
    try {
      setProviders(await fetchProviders())
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取 Provider 列表')
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="providers-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Provider</p>
            <h2 id="providers-title">模型服务与凭证</h2>
          </div>
          <div className={styles.actions}>
            <button className={styles.iconButton} title="刷新" aria-label="刷新 Provider" onClick={() => void refresh()}><RefreshCw size={15} /></button>
            <button className={styles.iconButton} title="关闭" aria-label="关闭" onClick={onClose}><X size={16} /></button>
          </div>
        </header>

        <div className={styles.body}>
          {providers === null
            ? <p className={styles.message}>读取 Provider 中…</p>
            : providers.map(provider => (
                <div key={provider.id} className={styles.row}>
                  <span className={`${styles.status} ${provider.configured ? styles.configured : ''}`} aria-hidden="true" />
                  <span className={styles.identity}>
                    <strong>{provider.name}</strong>
                    <span>{provider.id}</span>
                  </span>
                  <span className={styles.meta}>
                    <span>
                      {provider.modelCount}
                      {' '}
                      个模型
                    </span>
                    <span>{provider.configured ? authLabel(provider) : '未配置'}</span>
                  </span>
                </div>
              ))}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
      </section>
    </div>
  )
}
