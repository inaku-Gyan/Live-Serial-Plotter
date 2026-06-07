<script setup lang="ts">
import type { MonitorStore } from "../store";

defineProps<{
  store: MonitorStore;
}>();
</script>

<template>
  <div
    class="error-toast"
    :class="{ 'error-toast-visible': store.state.errorVisible }"
    role="status"
    aria-live="polite"
  >
    {{ store.state.errorMessage }}
  </div>
</template>
