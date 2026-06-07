<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { MonitorStore } from "../store";

const props = defineProps<{
  store: MonitorStore;
}>();

const outputWorkspace = ref<HTMLElement>();

onMounted(() => {
  if (outputWorkspace.value !== undefined) {
    props.store.mountOutputs(outputWorkspace.value);
  }
});
</script>

<template>
  <section ref="outputWorkspace" class="workspace" aria-label="Monitor outputs"></section>
</template>
