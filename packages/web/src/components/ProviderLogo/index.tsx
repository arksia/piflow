import type { ProviderBrand } from './brand'
import claude from './assets/claude-color.svg'
import deepseek from './assets/deepseek-color.svg'
import gemini from './assets/gemini-color.svg'
import openai from './assets/openai.svg'
import styles from './styles.module.css'

const logos = { claude, openai, gemini, deepseek }
export default function ProviderLogo({ brand, name = '', size = 24 }: { brand: ProviderBrand, name?: string, size?: number }) {
  return brand === 'unknown'
    ? <span className={styles.initials} aria-hidden="true" style={{ fontSize: size * 0.57 }}>{name.trim().slice(0, 2).toUpperCase() || 'AI'}</span>
    : <img className={`${styles.logo} ${brand === 'openai' ? styles.monochrome : ''}`} src={logos[brand]} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
