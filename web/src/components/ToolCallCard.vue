<script setup lang="ts">
import type { ToolState } from '../ws'
import { computed, ref } from 'vue'

const props = defineProps<{
  call: { id: string, name: string, arguments?: Record<string, unknown> }
  state?: ToolState
}>()

const open = ref(false)

const summary = computed(() => {
  const a = props.call.arguments ?? {}
  const s = a.command ?? a.path ?? a.pattern ?? a.query ?? a.url ?? ''
  const str = String(s)
  return str.length > 72 ? `${str.slice(0, 72)}…` : str
})

const diff = computed(() => {
  const d = props.state?.result?.details
  const text = (d?.diff ?? d?.patch) as string | undefined
  if (!text)
    return null
  return text.split('\n').map(line => ({
    line,
    cls: line.startsWith('+') && !line.startsWith('+++')
      ? 'add'
      : line.startsWith('-') && !line.startsWith('---')
        ? 'del'
        : line.startsWith('@@')
          ? 'hunk'
          : '',
  }))
})

const output = computed(() => {
  const st = props.state
  const src = st?.partial ?? st?.result
  const text = (src?.content ?? [])
    .map(c => c.text ?? '')
    .join('')
    .trimEnd()
  if (!text)
    return ''
  const lines = text.split('\n')
  return lines.length > 60 ? `${lines.slice(0, 60).join('\n')}\n… 共 ${lines.length} 行` : text
})

const status = computed(() => {
  if (props.state?.running)
    return 'running'
  if (props.state?.isError)
    return 'error'
  if (props.state?.result)
    return 'done'
  return 'pending'
})
</script>

<template>
  <div class="tool recede" :class="status">
    <button class="head" @click="open = !open">
      <span class="chev" :class="{ open }">›</span>
      <span class="name">{{ call.name }}</span>
      <span class="summary">{{ summary }}</span>
      <span v-if="status === 'running'" class="sig" />
      <span v-else-if="status === 'error'" class="err">失败</span>
    </button>

    <div v-if="open" class="body">
      <div v-if="diff" class="diff">
        <div v-for="(l, i) in diff" :key="i" class="dline" :class="l.cls">
          {{ l.line }}
        </div>
      </div>
      <pre v-else-if="output" class="out">{{ output }}</pre>
      <div v-else class="none">
        无输出
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool {
  margin: 6px 0;
  border-left: 2px solid var(--c-line);
  font-size: 0.85rem;
}

.tool.running {
  border-left-color: var(--c-signal);
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 4px 0 4px 10px;
  color: var(--c-muted);
}

.chev {
  display: inline-block;
  transition: transform 0.2s var(--ease);
  color: var(--c-faint);
}

.chev.open {
  transform: rotate(90deg);
}

.name {
  font-family: var(--font-mono);
  color: var(--c-mid);
  flex-shrink: 0;
}

.summary {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sig {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-signal);
  animation: pulse 1.2s ease infinite;
  align-self: center;
}

@keyframes pulse {
  50% { opacity: 0.3; }
}

.err {
  color: #ffa198;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.body {
  padding: 4px 0 8px 10px;
}

.out {
  margin: 0;
  background: var(--c-code-bg);
  border-radius: 6px;
  padding: 10px 14px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--c-body);
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.diff {
  background: var(--c-code-bg);
  border-radius: 6px;
  padding: 8px 0;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.5;
  overflow-x: auto;
}

.dline {
  padding: 0 14px;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  color: var(--c-muted);
}

.dline.add {
  background: var(--c-diff-add);
  color: var(--c-diff-add-fg);
}

.dline.del {
  background: var(--c-diff-del);
  color: var(--c-diff-del-fg);
}

.dline.hunk {
  color: var(--c-faint);
}

.none {
  color: var(--c-faint);
  font-size: 0.8rem;
}
</style>
