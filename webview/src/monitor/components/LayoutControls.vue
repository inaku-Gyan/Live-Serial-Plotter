<script setup lang="ts">
import { usePageStore } from "../store";

const store = usePageStore();
const { state } = store;

function handleSaveAs(): void {
  const target = state.layoutTargets[0];

  if (target === undefined) {
    store.showError("No user or workspace layout target is configured.");
    return;
  }

  const layoutId = window.prompt("Layout id", state.activeLayout.id);

  if (layoutId === null || layoutId.trim().length === 0) {
    return;
  }

  store.saveLayoutAs(layoutId.trim(), target);
}
</script>

<template>
  <section class="layout-controls" aria-label="Layout controls">
    <div class="layout-controls-summary">
      <strong>{{ state.activeLayout.name }}</strong>
      <span>{{ state.layoutKey }}</span>
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
