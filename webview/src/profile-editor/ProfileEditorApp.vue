<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import type { ToProfileEditorWebviewMessage } from "../../../src/shared/protocol";
import type { ProfileEditorStore } from "./store";
import EditorPage from "./components/EditorPage.vue";
import HomePage from "./components/HomePage.vue";
import StatusBlock from "./components/StatusBlock.vue";

const props = defineProps<{
  store: ProfileEditorStore;
}>();

const isReady = computed(() => props.store.isReady.value);

function handleHostMessage(event: MessageEvent<ToProfileEditorWebviewMessage>): void {
  props.store.handleHostMessage(event.data);
}

function handlePointerDown(event: PointerEvent): void {
  const target = event.target;

  if (target instanceof Element && target.closest(".profile-list-menu-root") !== null) {
    return;
  }

  props.store.closeProfileMenu();
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    props.store.closeProfileMenu();
  }
}

onMounted(() => {
  window.addEventListener("message", handleHostMessage);
  document.addEventListener("pointerdown", handlePointerDown, { capture: true });
  document.addEventListener("keydown", handleKeyDown);
  props.store.requestProfileEditorState();
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleHostMessage);
  document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  document.removeEventListener("keydown", handleKeyDown);
  props.store.dispose();
});
</script>

<template>
  <main v-if="!isReady" class="profile-editor">Loading profiles...</main>
  <main v-else-if="store.state.view === 'home'" class="profile-home">
    <HomePage :store="store" />
    <StatusBlock v-if="store.state.statusText.length > 0" :text="store.state.statusText" />
  </main>
  <main v-else class="profile-editor">
    <EditorPage :store="store" />
    <StatusBlock v-if="store.state.statusText.length > 0" :text="store.state.statusText" />
  </main>
</template>
