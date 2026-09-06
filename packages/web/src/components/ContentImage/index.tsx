import type { ImageContent } from '@piflow/protocol'
import styles from './styles.module.css'

interface Props {
  image: ImageContent
  alt: string
}

export default function ContentImage({ image, alt }: Props) {
  return <img className={styles.image} src={`data:${image.mimeType};base64,${image.data}`} alt={alt} loading="lazy" />
}
