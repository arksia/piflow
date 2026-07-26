<script setup lang="ts">
import { computed, inject } from "vue";
import { MdKey } from "../main";

const props = defineProps<{ text: string }>();
const md = inject(MdKey)!;
const html = computed(() => md.render(props.text ?? ""));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="md" v-html="html" />
</template>
