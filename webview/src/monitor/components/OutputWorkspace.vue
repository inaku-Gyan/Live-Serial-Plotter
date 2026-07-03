<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useMonitorStore } from "../store";

const store = useMonitorStore();
const outputWorkspace = ref<HTMLElement>();

onMounted(() => {
  if (outputWorkspace.value !== undefined) {
    store.mountOutputs(outputWorkspace.value);
  }
});
</script>

<template>
  <section ref="outputWorkspace" class="workspace" aria-label="Monitor outputs"></section>
</template>
