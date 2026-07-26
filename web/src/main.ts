import { createApp } from "vue";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./styles/main.css";
import App from "./App.vue";
import { createMd, type Md } from "./md";
import { initWs } from "./ws";
import { provide, type InjectionKey } from "vue";

export const MdKey: InjectionKey<Md> = Symbol("md");

const md = await createMd();
const app = createApp(App);
app.provide(MdKey, md);
initWs();
app.mount("#app");
