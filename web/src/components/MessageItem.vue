<script setup lang="ts">
import type { ChatMessage, TextBlock, ToolState } from '../ws'
import { computed } from 'vue'
import MarkdownView from './MarkdownView.vue'
import ToolCallCard from './ToolCallCard.vue'

const props = defineProps<{
  message: ChatMessage
  toolResults: Record<string, ToolState>
  live?: boolean
}>()

const role = computed(() => props.message.role)

const text = computed(() => {
  const c = props.message.content
  return typeof c === 'string' ? c : ''
})

const userText = computed(() => {
  const c = props.message.content
  if (typeof c === 'string')
    return c
  if (Array.isArray(c)) {
    return c
      .filter((block): block is TextBlock => block.type === 'text')
      .map(block => block.text)
      .join(' ')
  }
  return ''
})

const blocks = computed(() =>
  Array.isArray(props.message.content) ? props.message.content : [],
)

function time(ts?: number) {
  if (!ts)
    return ''
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <!-- user -->
  <div v-if="role === 'user'" class="msg user" :data-user="userText">
    <div class="u-marker">
      ›
    </div>
    <div class="u-body">
      <span v-if="typeof message.content === 'string'" class="u-text">{{ text }}</span>
      <template v-else>
        <template v-for="(b, i) in blocks" :key="i">
          <span v-if="b.type === 'text'" class="u-text">{{ b.text }}</span>
          <span v-else-if="b.type === 'image'" class="u-image">[图片]</span>
        </template>
      </template>
      <span class="time">{{ time(message.timestamp) }}</span>
    </div>
  </div>

  <!-- assistant -->
  <div v-else-if="role === 'assistant'" class="msg assistant" :class="{ live }">
    <template v-for="(b, i) in blocks" :key="i">
      <MarkdownView v-if="b.type === 'text'" :text="b.text" />
      <details v-else-if="b.type === 'thinking'" class="thinking recede">
        <summary>思考过程</summary>
        <div class="t-body">
          {{ b.thinking }}
        </div>
      </details>
      <ToolCallCard
        v-else-if="b.type === 'toolCall'"
        :call="b"
        :state="toolResults[b.id]"
      />
    </template>
    <span v-if="live" class="caret" />
  </div>

  <!-- bash execution (!command) -->
  <div v-else-if="role === 'bashExecution'" class="msg">
    <ToolCallCard
      :call="{ name: 'bash', arguments: { command: message.command }, id: `bash-${message.timestamp}` }"
      :state="{ result: { content: [{ type: 'text', text: message.output ?? '' }] }, isError: message.exitCode !== 0 }"
    />
  </div>

  <!-- tool results render inside ToolCallCard; nothing here -->
</template>

<style scoped>
.msg {
  margin-bottom: 20px;
}

.user {
  display: flex;
  gap: 10px;
}

.u-marker {
  color: var(--c-signal);
  font-weight: 700;
  opacity: 0.9;
  user-select: none;
}

.u-body {
  flex: 1;
  min-width: 0;
}

.u-text {
  color: var(--c-ink);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.u-image {
  color: var(--c-muted);
  font-size: 0.85rem;
}

.time {
  display: inline-block;
  margin-left: 10px;
  color: var(--c-faint);
  font-size: 0.72rem;
}

.assistant.live .caret {
  display: inline-block;
  width: 8px;
  height: 1.1em;
  vertical-align: text-bottom;
  background: var(--c-signal);
  animation: blink 1s steps(2) infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.thinking {
  margin: 8px 0;
  font-size: 0.85rem;
  color: var(--c-muted);
}

.thinking summary {
  cursor: pointer;
  user-select: none;
}

.t-body {
  margin-top: 6px;
  padding-left: 12px;
  border-left: 2px solid var(--c-line);
  white-space: pre-wrap;
  font-size: 0.82rem;
  line-height: 1.6;
}
</style>
