import type { ImageContent } from '@piflow/protocol'

interface Props {
  image: ImageContent
  alt: string
}

export default function ContentImage({ image, alt }: Props) {
  return <img className="pf-max-w-[min(100%,640px)] pf-block pf-w-auto pf-max-h-[480px] pf-border pf-border-solid pf-border-line pf-rounded-[6px] pf-object-contain" src={`data:${image.mimeType};base64,${image.data}`} alt={alt} loading="lazy" />
}
