<script setup lang="ts">
import { usePageStore } from "../store";

const store = usePageStore();
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
