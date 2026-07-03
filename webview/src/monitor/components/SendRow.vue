<script setup lang="ts">
import { ref } from "vue";
import { useMonitorStore } from "../store";

const store = useMonitorStore();
const { sendDisabled } = store;
const text = ref("");

function handleSubmit(): void {
  if (store.sendText(text.value)) {
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
      :disabled="sendDisabled"
    />
    <button class="button button-primary" type="submit" :disabled="sendDisabled">Send</button>
  </form>
</template>
