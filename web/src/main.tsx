import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createMd, MdContext } from './md'
import { initWs } from './ws'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import './styles/main.css'

const md = await createMd()
const root = document.querySelector('#app')

if (!root)
  throw new Error('app root not found')

initWs()
createRoot(root).render(
  <StrictMode>
    <MdContext value={md}>
      <App />
    </MdContext>
  </StrictMode>,
)
