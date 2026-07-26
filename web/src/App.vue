<script setup lang="ts">
import ChatView from './components/ChatView.vue'
import SessionList from './components/SessionList.vue'
import { store } from './ws'
</script>

<template>
  <div class="shell">
    <aside class="sidebar" :class="{ open: store.sidebarOpen }">
      <SessionList />
    </aside>
    <div v-if="store.sidebarOpen" class="scrim" @click="store.sidebarOpen = false" />
    <main class="main">
      <ChatView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
}

.sidebar {
  width: 264px;
  flex-shrink: 0;
  border-right: 1px solid var(--c-line);
  overflow-y: auto;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.scrim {
  display: none;
}

@media (width <= 768px) {
  .sidebar {
    position: fixed;
    z-index: 20;
    inset: 0 auto 0 0;
    background: var(--c-bg);
    transform: translateX(-100%);
    transition: transform 0.25s var(--ease);
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .scrim {
    display: block;
    position: fixed;
    z-index: 10;
    inset: 0;
    background: rgb(0 0 0 / 40%);
    backdrop-filter: blur(5px);
  }
}
</style>
