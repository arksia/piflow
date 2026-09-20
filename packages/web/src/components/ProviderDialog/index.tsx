import type { ProviderAuthEvent, ProviderAuthPrompt, ProviderInfo, ServerMessage } from '@piflow/protocol'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ModalFrame } from '../../motion'
import { cancelProviderAuth, checkProvider, fetchProviders, refreshProvider, respondProviderAuth, startProviderLogin } from '../../session/actions'
import IconButton from '../IconButton'
import styles from './styles.module.css'

interface Props {
  onClose: () => void
}

type AuthDisplayEvent = Extract<ProviderAuthEvent, { type: 'info' | 'auth_url' | 'device_code' | 'progress' }>

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
  const [operation, setOperation] = useState<{ id: string, providerId: string, prompt?: ProviderAuthPrompt, event?: AuthDisplayEvent, busy: boolean } | null>(null)
  const [action, setAction] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<Record<string, string>>({})
  const operationRef = useRef(operation)
  operationRef.current = operation

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => () => {
    const current = operationRef.current
    if (current)
      void cancelProviderAuth(current.id).catch(() => {})
  }, [])

  useEffect(() => {
    function onAuth(event: Event) {
      const message = (event as CustomEvent<Extract<ServerMessage, { type: 'provider_auth' }>>).detail
      const authEvent = message.event as ProviderAuthEvent
      if (authEvent.type === 'prompt') {
        setOperation(current => current && current.id === message.operationId ? { ...current, prompt: authEvent.prompt, event: undefined, busy: false } : current)
      }
      else if (authEvent.type === 'completed') {
        setOperation(current => current?.id === message.operationId ? null : current)
        void refresh()
      }
      else if (authEvent.type === 'failed') {
        setOperation(current => current?.id === message.operationId ? null : current)
        setError(authEvent.message)
      }
      else {
        setOperation(current => current && current.id === message.operationId ? { ...current, event: authEvent as AuthDisplayEvent } : current)
      }
    }
    window.addEventListener('piflow:provider-auth', onAuth)
    return () => window.removeEventListener('piflow:provider-auth', onAuth)
  }, [])

  async function refresh() {
    setError(null)
    try {
      setProviders(await fetchProviders())
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取 Provider 列表')
    }
  }

  async function login(provider: ProviderInfo, type: 'api_key' | 'oauth') {
    if (operation)
      return
    setError(null)
    try {
      const response = await startProviderLogin(provider.id, type)
      setOperation({ id: response.operationId, providerId: provider.id, prompt: response.prompt, busy: !response.prompt })
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始登录')
    }
  }

  async function refreshProviderModels(provider: ProviderInfo) {
    if (action)
      return
    setAction(provider.id)
    setError(null)
    try {
      setProviders(await refreshProvider(provider.id))
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型发现失败')
    }
    finally {
      setAction(null)
    }
  }

  async function testProvider(provider: ProviderInfo) {
    if (action)
      return
    setAction(provider.id)
    setError(null)
    try {
      const result = await checkProvider(provider.id)
      setCheckResult(current => ({ ...current, [provider.id]: result.configured ? '可用' : '未配置' }))
    }
    catch (reason) {
      setCheckResult(current => ({ ...current, [provider.id]: '失败' }))
      setError(reason instanceof Error ? reason.message : 'Provider 测试失败')
    }
    finally {
      setAction(null)
    }
  }

  async function answer(value: string) {
    if (!operation?.prompt)
      return
    const current = operation
    const prompt = current.prompt!
    setOperation({ ...current, prompt: undefined, busy: true })
    try {
      await respondProviderAuth(current.id, prompt.id, value)
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法提交认证信息')
      await cancelProviderAuth(current.id).catch(() => {})
      setOperation(null)
    }
  }

  function cancel() {
    if (operation)
      void cancelProviderAuth(operation.id).catch(() => {})
    setOperation(null)
  }

  return (
    <ModalFrame backdropClass={styles.backdrop} dialogClass={styles.dialog} onClose={onClose} labelledBy="providers-title">
      {close => (
        <>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Provider</p>
              <h2 id="providers-title">模型服务与凭证</h2>
            </div>
            <div className={styles.actions}>
              <IconButton label="刷新 Provider" onClick={() => void refresh()}>
                <RefreshCw />
              </IconButton>
              <IconButton label="关闭" onClick={close}>
                <X />
              </IconButton>
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
                      {checkResult[provider.id] ? <span>{checkResult[provider.id]}</span> : null}
                    </span>
                    <button className={styles.login} title={`测试 ${provider.name}`} disabled={action !== null || operation !== null} onClick={() => void testProvider(provider)}>测试</button>
                    <button className={styles.login} title={`刷新 ${provider.name} 模型`} disabled={action !== null || operation !== null} onClick={() => void refreshProviderModels(provider)}>刷新模型</button>
                    {!provider.configured && provider.authTypes.includes('api_key')
                      ? <button className={styles.login} disabled={operation !== null} onClick={() => void login(provider, 'api_key')}>API key</button>
                      : null}
                    {!provider.configured && provider.authTypes.includes('oauth')
                      ? <button className={styles.login} disabled={operation !== null} onClick={() => void login(provider, 'oauth')}>OAuth</button>
                      : null}
                  </div>
                ))}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
          {operation?.prompt
            ? <AuthPromptDialog prompt={operation.prompt} busy={operation.busy} onSubmit={value => void answer(value)} onCancel={cancel} />
            : operation?.event
              ? <AuthEventPanel event={operation.event} onCancel={cancel} />
              : null}
        </>
      )}
    </ModalFrame>
  )
}

function AuthEventPanel({ event, onCancel }: { event: AuthDisplayEvent, onCancel: () => void }) {
  return (
    <div className={styles.prompt}>
      {event.type === 'auth_url'
        ? (
            <a className={styles.authLink} href={event.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              打开授权页面
            </a>
          )
        : event.type === 'device_code'
          ? (
              <>
                <p>请打开授权页面并输入设备码</p>
                <a className={styles.authLink} href={event.verificationUri} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} />
                  打开授权页面
                </a>
                <code className={styles.deviceCode}>{event.userCode}</code>
              </>
            )
          : <p>{event.type === 'info' || event.type === 'progress' ? event.message : ''}</p>}
      <div className={styles.promptActions}>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

function AuthPromptDialog({ prompt, busy, onSubmit, onCancel }: { prompt: ProviderAuthPrompt, busy: boolean, onSubmit: (value: string) => void, onCancel: () => void }) {
  const [value, setValue] = useState('')
  const authPrompt = prompt.prompt
  const isSelect = authPrompt.type === 'select'
  return (
    <div className={styles.prompt}>
      <p>{authPrompt.message}</p>
      {isSelect
        ? <select value={value} onChange={event => setValue(event.target.value)}>{(authPrompt as Extract<typeof authPrompt, { type: 'select' }>).options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        : <input autoFocus type={authPrompt.type === 'secret' ? 'password' : 'text'} placeholder={'placeholder' in authPrompt && typeof authPrompt.placeholder === 'string' ? authPrompt.placeholder : undefined} value={value} onChange={event => setValue(event.target.value)} />}
      <div className={styles.promptActions}>
        <button onClick={onCancel}>取消</button>
        <button disabled={busy || !value} onClick={() => onSubmit(value)}>继续</button>
      </div>
    </div>
  )
}
