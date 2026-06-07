<script setup lang="ts">
import type { MonitorStore } from "../store";

const props = defineProps<{
  store: MonitorStore;
}>();

function handleSaveAs(): void {
  const target = props.store.state.layoutTargets[0];

  if (target === undefined) {
    props.store.showError("No user or workspace layout target is configured.");
    return;
  }

  const layoutId = window.prompt("Layout id", props.store.state.activeLayout.id);

  if (layoutId === null || layoutId.trim().length === 0) {
    return;
  }

  props.store.saveLayoutAs(layoutId.trim(), target);
}
</script>

<template>
  <section class="layout-controls" aria-label="Layout controls">
    <div class="layout-controls-summary">
      <strong>{{ store.state.activeLayout.name }}</strong>
      <span>{{ store.state.layoutKey }}</span>
    </div>
    <div class="layout-controls-actions">
      <button type="button" class="button button-secondary" @click="store.resetPageLayout">
        Reset Layout
      </button>
      <button type="button" class="button button-secondary" @click="store.saveLayout">
        Save Layout
      </button>
      <button type="button" class="button" @click="handleSaveAs">Save As</button>
    </div>
  </section>
</template>
