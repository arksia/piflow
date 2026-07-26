<script setup lang="ts">
import type { SessionInfoLite } from '../ws'
import { computed } from 'vue'
import { newSession, openSession, store } from '../ws'

const groups = computed(() => {
  const byCwd = new Map<string, SessionInfoLite[]>()
  for (const s of store.sessions) {
    const list = byCwd.get(s.cwd) ?? []
    list.push(s)
    byCwd.set(s.cwd, list)
  }
  return [...byCwd.entries()].map(([cwd, items]) => ({
    cwd: shorten(cwd),
    items,
  }))
})

function shorten(p: string) {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

function rel(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)
    return '刚刚'
  if (m < 60)
    return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24)
    return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30)
    return `${d} 天前`
  return new Date(iso).toLocaleDateString()
}

function label(s: SessionInfoLite) {
  return s.name || s.firstMessage || '空会话'
}

async function pick(s: SessionInfoLite) {
  if (!store.connected)
    return
  try {
    await openSession(s.path)
    store.sidebarOpen = false
  }
  catch (error) {
    console.error('[piflow]', error)
  }
}

async function create() {
  if (!store.connected)
    return
  try {
    await newSession()
    store.sidebarOpen = false
  }
  catch (error) {
    console.error('[piflow]', error)
  }
}
</script>

<template>
  <div class="list">
    <div class="top">
      <span class="brand">piflow</span>
      <button class="new recede" title="新会话" :disabled="!store.connected" @click="create">
        + 新会话
      </button>
    </div>

    <div v-for="g in groups" :key="g.cwd" class="group">
      <div class="cwd">
        {{ g.cwd }}
      </div>
      <button
        v-for="s in g.items"
        :key="s.path"
        class="item recede"
        :class="{ active: store.activeKey === s.path }"
        :disabled="!store.connected"
        @click="pick(s)"
      >
        <span class="label">{{ label(s) }}</span>
        <span class="meta">{{ rel(s.modified) }} · {{ s.messageCount }} 条</span>
      </button>
    </div>

    <div v-if="!store.connected" class="offline">
      连接中…
    </div>
  </div>
</template>

<style scoped>
.list {
  padding: 16px 12px 32px;
  font-size: 0.9rem;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 16px;
}

.brand {
  color: var(--c-ink);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.new {
  color: var(--c-muted);
  font-size: 0.85rem;
}

.group {
  margin-bottom: 20px;
}

.cwd {
  color: var(--c-faint);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  padding: 0 8px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px;
  border-radius: 6px;
  line-height: 1.4;
}

.item.active {
  opacity: 1;
  background: var(--c-raise);
}

.label {
  display: block;
  color: var(--c-mid);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: block;
  color: var(--c-faint);
  font-size: 0.75rem;
}

.offline {
  padding: 8px;
  color: var(--c-faint);
  font-size: 0.8rem;
}
</style>
