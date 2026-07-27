<script setup lang="ts">
import type { SessionView, UsageWindow } from '../ws'
import { computed, nextTick, ref, watch } from 'vue'
import { abort, requestUsage, sendPrompt, setModel, setThinking, store } from '../ws'

const props = defineProps<{ view: SessionView | null }>()

const text = ref('')
const area = ref<HTMLTextAreaElement>()
const modelOpen = ref(false)

const modelGroups = computed(() => {
  const byProvider = new Map<string, typeof store.models>()
  for (const m of store.models) {
    const list = byProvider.get(m.provider) ?? []
    list.push(m)
    byProvider.set(m.provider, list)
  }
  return [...byProvider.entries()]
})

function pickModel(provider: string, modelId: string) {
  if (props.view)
    setModel(props.view.key, provider, modelId)
  modelOpen.value = false
}

const usage = computed(() => {
  const p = props.view?.model?.provider
  const u = p ? store.usage[p] : null
  return u?.supported ? u : null
})

// Display the quota from the most constrained window.
const quota = computed(() => {
  const ws = usage.value?.windows
  if (!ws?.length)
    return null
  return Math.min(...ws.map(w => w.remaining))
})

const quotaTitle = computed(
  () => usage.value?.windows.map(fmtWindow).join('\n') ?? '',
)

// Show context usage as the ring around the send button.
const ctxPct = computed(() => Math.round(props.view?.context?.percent ?? 0))
const ctxLevel = computed(() => ctxPct.value >= 85 ? 'danger' : ctxPct.value >= 70 ? 'warning' : 'normal')
const ctxTitle = computed(() => {
  const c = props.view?.context
  if (!c)
    return ''
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
  return `上下文已用 ${ctxPct.value}%（${k(c.tokens)} / ${k(c.contextWindow)}）`
})

// Refresh on page load, model changes, and completed agent turns.
watch(
  () => [props.view?.key, props.view?.model?.id],
  () => {
    if (props.view)
      requestUsage(props.view.key)
  },
  { immediate: true },
)
watch(
  () => props.view?.isStreaming,
  (s, prev) => {
    if (prev && !s && props.view)
      requestUsage(props.view.key, true)
  },
)

function toggleModels() {
  modelOpen.value = !modelOpen.value
  if (modelOpen.value && props.view)
    requestUsage(props.view.key)
}

function fmtWindow(w: UsageWindow) {
  const reset = w.resetTime ? new Date(w.resetTime) : null
  const when = reset
    ? w.minutes
      ? reset.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : reset.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    : ''
  const label = w.minutes ? `${Math.round(w.minutes / 60)}h 窗口` : '周期额度'
  return `${label} · 剩 ${w.remaining}% · ${when} 重置`
}

function cycleThinking() {
  const v = props.view
  if (!v)
    return
  const levels = v.thinkingLevels.length
    ? v.thinkingLevels
    : ['off', 'low', 'medium', 'high']
  const cur = levels.indexOf(v.thinkingLevel ?? '')
  const next = levels[(cur + 1) % levels.length]
  if (next)
    setThinking(v.key, next)
}

// Move a hero preset into the composer draft.
watch(
  () => store.draft,
  async (d) => {
    if (!d)
      return
    text.value = d
    store.draft = ''
    await nextTick()
    area.value?.focus()
  },
)

const canSend = () => store.connected && text.value.trim().length > 0

async function submit() {
  if (!canSend())
    return
  const t = text.value.trim()
  try {
    await sendPrompt(t)
    text.value = ''
    await nextTick()
    area.value?.focus()
  }
  catch (error) {
    console.error('[piflow]', error)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}

function onAbort() {
  if (props.view)
    abort(props.view.key)
}
</script>

<template>
  <div class="bar">
    <div class="col">
      <div v-if="view && (view.queue.steering.length || view.queue.followUp.length)" class="queue">
        队列中 {{ view.queue.steering.length + view.queue.followUp.length }} 条 · 将在合适的时机送达
      </div>

      <div class="box" :class="{ streaming: view?.isStreaming }">
        <textarea
          ref="area"
          v-model="text"
          rows="2"
          placeholder="和 pi 说点什么…"
          @keydown="onKeydown"
        />
        <div class="footer">
          <div class="left">
            <span v-if="view?.isStreaming" class="steer">
              <span class="dot" />steer · 发送将插队传达
            </span>
            <button
              v-else-if="view?.thinkingLevels.length"
              class="think recede"
              title="切换思考强度"
              @click="cycleThinking"
            >
              thinking · {{ view.thinkingLevel }}
            </button>
          </div>
          <div class="right">
            <span
              v-if="quota != null"
              class="quota"
              :class="{ low: quota < 20 }"
              :title="quotaTitle"
            >{{ quota }}%</span>
            <button v-if="view?.model" class="model recede" @click="toggleModels">
              {{ view.model.name }}
            </button>
            <button
              v-if="view?.isStreaming"
              class="btn ring stop"
              :class="ctxLevel"
              :style="{ '--p': ctxPct }"
              :title="`中断 · ${ctxTitle}`"
              @click="onAbort"
            >
              <span class="core">■</span>
            </button>
            <button
              v-else
              class="btn ring send"
              :class="[ctxLevel, { ready: canSend() }]"
              :style="{ '--p': ctxPct }"
              :title="ctxTitle || '发送'"
              :disabled="!canSend()"
              @click="submit"
            >
              <span class="core">↑</span>
            </button>
          </div>
        </div>

        <template v-if="modelOpen">
          <div class="scrim" @click="modelOpen = false" />
          <div class="popover">
            <div v-for="[provider, items] in modelGroups" :key="provider" class="pgroup">
              <div class="pname">
                {{ provider }}
              </div>
              <button
                v-for="m in items"
                :key="m.id"
                class="pitem"
                :class="{ current: view?.model?.id === m.id }"
                @click="pickModel(m.provider, m.id)"
              >
                {{ m.name }}
              </button>
            </div>
            <div v-if="usage" class="usage">
              <div v-for="(w, i) in usage.windows" :key="i">
                {{ fmtWindow(w) }}
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
@property --p {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

.bar {
  padding: 8px 20px calc(14px + env(safe-area-inset-bottom));
}

.col {
  width: min(calc(100% - 48px), calc(var(--chat-w, 1180px) - 60px));
  margin: 0 auto;
  transition: width 0.25s var(--ease);
}

.queue {
  color: var(--c-muted);
  font-size: 0.78rem;
  padding: 0 4px 8px;
}

.box {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--c-raise);
  border: 1px solid var(--c-line);
  border-radius: 12px;
  transition: border-color 0.3s var(--ease);
}

.box:focus-within {
  border-color: #2a2a2a;
}

.box.streaming {
  border-color: #a160fc44;
}

.box.streaming:focus-within {
  border-color: #a160fc66;
}

textarea {
  width: 100%;
  min-height: 56px;
  max-height: 220px;
  field-sizing: content;
  resize: none;
  border: none;
  outline: none;
  background: none;
  color: var(--c-ink);
  font-family: var(--font-sans);
  font-size: 0.95rem;
  line-height: 1.6;
  padding: 14px 14px 4px;
}

textarea::placeholder {
  color: var(--c-faint);
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 8px 14px;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.steer {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--c-signal);
  font-size: 0.75rem;
}

.steer .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-signal);
  animation: pulse 1.2s var(--ease) infinite;
}

@keyframes pulse {
  50% { opacity: 0.3; }
}

.think {
  color: var(--c-faint);
  font-size: 0.75rem;
}

.think:hover {
  color: var(--c-muted);
}

.quota {
  color: var(--c-faint);
  font-size: 0.72rem;
  font-family: var(--font-mono);
}

.quota.low {
  color: #f85149;
}

.model {
  color: var(--c-muted);
  font-size: 0.8rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.popover {
  position: absolute;
  z-index: 31;
  right: 8px;
  bottom: calc(100% + 6px);
  width: 240px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--c-raise);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  padding: 6px;
}

.pgroup + .pgroup {
  margin-top: 6px;
}

.pname {
  color: var(--c-faint);
  font-size: 0.7rem;
  font-family: var(--font-mono);
  padding: 4px 8px 2px;
}

.pitem {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  border-radius: 5px;
  color: var(--c-muted);
  font-size: 0.82rem;
  opacity: 0.7;
  transition: opacity 0.15s var(--ease);
}

.pitem:hover {
  opacity: 1;
  background: #ffffff08;
}

.pitem.current {
  opacity: 1;
  color: var(--c-ink);
}

.usage {
  margin-top: 6px;
  padding: 8px 8px 4px;
  border-top: 1px solid var(--c-line);
  color: var(--c-faint);
  font-size: 0.72rem;
  line-height: 1.7;
}

.btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  font-size: 0.85rem;
  border: none;
  transition: all 0.2s var(--ease);
}

.btn.ring {
  --ring-color: var(--c-faint);

  border-radius: 50%;
  background: conic-gradient(var(--ring-color) calc(var(--p) * 1%), #ffffff14 0);
  padding: 2px;
  transition: --p 0.45s var(--ease);
}

.btn.ring.warning {
  --ring-color: #d29922;
}

.btn.ring.danger {
  --ring-color: #f85149;
}

.btn.ring .core {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--c-raise);
  display: grid;
  place-items: center;
  color: var(--c-faint);
  transition: color 0.2s var(--ease);
}

.btn.stop .core {
  color: var(--c-signal);
}

.btn.send.ready .core {
  color: var(--c-mid);
}

.btn.send:disabled {
  cursor: default;
}

.btn.send.ready:hover .core {
  color: var(--c-ink);
}

@media (prefers-reduced-motion: reduce) {
  .btn.ring {
    transition: none;
  }
}
</style>
