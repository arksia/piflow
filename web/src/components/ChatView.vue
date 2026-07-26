<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { store } from "../ws";
import MessageItem from "./MessageItem.vue";
import InputBar from "./InputBar.vue";

const view = computed(() => (store.activeKey ? store.views[store.activeKey] : null));
const scroller = ref<HTMLElement>();

const title = computed(() => {
  const key = store.activeKey;
  if (!key) return "piflow";
  const s = store.sessions.find((s) => s.path === key);
  return s ? s.name || s.firstMessage || "会话" : "新会话";
});

const presets = ["探索这个代码库", "回顾我的改动", "修一个 bug", "做个功能规划"];

// 聊天列宽：860 / 1180 / 1440 三档可调
const WIDTHS = [860, 1180, 1440];
const widthIdx = ref(Math.min(Number(localStorage.getItem("piflow.chatWidth") ?? 1), 2));
const chatW = computed(() => WIDTHS[widthIdx.value]);
function cycleWidth() {
  widthIdx.value = (widthIdx.value + 1) % WIDTHS.length;
  localStorage.setItem("piflow.chatWidth", String(widthIdx.value));
}

function usePreset(p: string) {
  store.draft = p;
}

const isEmpty = computed(() => !view.value || view.value.messages.length === 0);

watch(
  () => view.value?.tick,
  async () => {
    await nextTick();
    const el = scroller.value;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <div class="chat" :style="{ '--chat-w': chatW + 'px' }">
    <header class="bar">
      <button class="menu recede" @click="store.sidebarOpen = !store.sidebarOpen">☰</button>
      <span class="title">{{ title }}</span>
      <button class="width recede" title="切换聊天宽度" @click="cycleWidth">⇔</button>
      <span class="status" :class="{ on: view?.isStreaming }" />
    </header>

    <div ref="scroller" class="scroll" :class="{ centered: isEmpty }">
      <!-- hero：空会话 -->
      <div v-if="isEmpty" class="hero">
        <h1>今天做点什么？</h1>
        <div class="presets">
          <button v-for="p in presets" :key="p" class="pill recede" @click="usePreset(p)">
            {{ p }}
          </button>
        </div>
        <p v-if="!view" class="dim">也可以从左侧选择一个历史会话继续</p>
      </div>

      <!-- 消息流 -->
      <div v-else class="col">
        <MessageItem
          v-for="(m, i) in view!.messages"
          :key="i"
          :message="m"
          :tool-results="view!.toolResults"
        />
        <MessageItem
          v-if="view!.live"
          :message="view!.live"
          :tool-results="view!.toolResults"
          live
        />
        <div v-if="view!.isStreaming && !view!.live" class="pending">
          <span class="dot" />
        </div>
        <div v-if="view!.isCompacting" class="note">正在压缩上下文…</div>
        <div v-if="view!.error" class="error">{{ view!.error }}</div>
      </div>
    </div>

    <InputBar :view="view" />
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--c-line);
}

.menu {
  display: none;
  color: var(--c-muted);
  font-size: 1.1rem;
}

.title {
  flex: 1;
  color: var(--c-mid);
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.width {
  color: var(--c-muted);
  font-size: 0.9rem;
}

.status {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-faint);
  opacity: 0.4;
  transition: all 0.3s var(--ease);
}

.status.on {
  background: var(--c-signal);
  opacity: 1;
  animation: pulse 1.6s var(--ease) infinite;
}

@keyframes pulse {
  50% { opacity: 0.35; }
}

.scroll {
  flex: 1;
  overflow-y: auto;
}

.scroll.centered {
  display: flex;
  align-items: center;
  justify-content: center;
}

.col {
  width: min(calc(100% - 48px), var(--chat-w));
  margin: 0 auto;
  padding: 24px 0 16px;
  transition: width 0.25s var(--ease);
}

/* hero */

.hero {
  text-align: center;
  padding: 40px 20px;
}

.hero h1 {
  margin: 0 0 24px;
  color: var(--c-mid);
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 480px;
  margin: 0 auto;
}

.pill {
  padding: 6px 14px;
  border: 1px solid var(--c-line);
  border-radius: 999px;
  color: var(--c-muted);
  font-size: 0.85rem;
  transition: border-color 0.2s var(--ease), opacity 0.2s var(--ease);
}

.pill:hover {
  border-color: var(--c-faint);
}

.hero .dim {
  margin-top: 24px;
  color: var(--c-faint);
  font-size: 0.82rem;
}

/* streaming indicators */

.pending {
  padding: 8px 0;
}

.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-signal);
  animation: pulse 1.2s var(--ease) infinite;
}

.note {
  color: var(--c-muted);
  font-size: 0.85rem;
  padding: 8px 0;
}

.error {
  color: #ffa198;
  font-size: 0.85rem;
  padding: 8px 0;
}

@media (max-width: 768px) {
  .menu { display: block; }
  .width { display: none; }
  .col { width: calc(100% - 32px); }
}
</style>
