import type { ComponentProps } from 'react'
import type { ControlAppearance } from '../form-control'
import { controlClasses } from '../form-control'

type Props = ComponentProps<'input'> & { appearance?: ControlAppearance }

export default function TextInput({ appearance = 'default', className = '', ...props }: Props) {
  return <input {...props} className={`${controlClasses(appearance, 'input')} ${className}`} />
}
