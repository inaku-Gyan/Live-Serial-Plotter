<script setup lang="ts">
import { onMounted, ref } from "vue";
import { usePageStore } from "../store";

const store = usePageStore();
const outputGrid = ref<HTMLElement>();

onMounted(() => {
  if (outputGrid.value !== undefined) {
    store.mountOutputGrid(outputGrid.value);
  }
});
</script>

<template>
  <section ref="outputGrid" class="output-grid" aria-label="Monitor outputs"></section>
</template>
