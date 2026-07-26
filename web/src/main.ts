import type { InjectionKey } from 'vue'
import type { Md } from './md'
import { createApp } from 'vue'
import App from './App.vue'
import { createMd } from './md'
import { initWs } from './ws'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import './styles/main.css'

export const MdKey: InjectionKey<Md> = Symbol('md')

const md = await createMd()
const app = createApp(App)
app.provide(MdKey, md)
initWs()
app.mount('#app')
