<script setup lang="ts">
import { useMonitorStore } from "../store";

const store = useMonitorStore();
const { state } = store;
</script>

<template>
  <div
    class="error-toast"
    :class="{ 'error-toast-visible': state.errorVisible }"
    role="status"
    aria-live="polite"
  >
    {{ state.errorMessage }}
  </div>
</template>
