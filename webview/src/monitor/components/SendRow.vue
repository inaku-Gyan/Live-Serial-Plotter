<script setup lang="ts">
import { ref } from "vue";
import type { MonitorStore } from "../store";

const props = defineProps<{
  store: MonitorStore;
}>();

const text = ref("");

function handleSubmit(): void {
  if (props.store.sendText(text.value)) {
    text.value = "";
  }
}
</script>

<template>
  <form class="send-row" @submit.prevent="handleSubmit">
    <input
      v-model="text"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder="Send text"
      :disabled="store.sendDisabled.value"
    />
    <button class="button button-primary" type="submit" :disabled="store.sendDisabled.value">
      Send
    </button>
  </form>
</template>
