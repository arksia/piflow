import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initClient } from './session/transport'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import 'katex/dist/katex.min.css'
import './styles/main.css'

const root = document.querySelector('#app')

if (!root)
  throw new Error('app root not found')

initClient()
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
