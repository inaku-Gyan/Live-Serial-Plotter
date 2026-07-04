<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import type { ToProfileEditorWebviewMessage } from "../../../src/shared/protocol";
import { useProfileEditorStore } from "./store";
import EditorPage from "./components/EditorPage.vue";
import HomePage from "./components/HomePage.vue";
import StatusBlock from "./components/StatusBlock.vue";

const store = useProfileEditorStore();

const isReady = computed(() => store.isReady.value);

function handleHostMessage(event: MessageEvent<ToProfileEditorWebviewMessage>): void {
  store.handleHostMessage(event.data);
}

function handlePointerDown(event: PointerEvent): void {
  const target = event.target;

  if (target instanceof Element && isInsideOpenProfileMenuRoot(target)) {
    return;
  }

  store.closeProfileMenu();
}

function handleFocusIn(event: FocusEvent): void {
  const target = event.target;

  if (target instanceof Element && isInsideOpenProfileMenuRoot(target)) {
    return;
  }

  store.closeProfileMenu();
}

function isInsideOpenProfileMenuRoot(target: Element): boolean {
  const openProfileKey = store.state.profileMenu?.profileKey;

  if (openProfileKey === undefined) {
    return false;
  }

  const menuRoot = target.closest<HTMLElement>(".profile-list-menu-root");
  return menuRoot?.dataset.profileKey === openProfileKey;
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    store.closeProfileMenu();
  }
}

onMounted(() => {
  window.addEventListener("message", handleHostMessage);
  document.addEventListener("pointerdown", handlePointerDown, { capture: true });
  document.addEventListener("focusin", handleFocusIn, { capture: true });
  document.addEventListener("keydown", handleKeyDown);
  store.requestProfileEditorState();
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleHostMessage);
  document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  document.removeEventListener("focusin", handleFocusIn, { capture: true });
  document.removeEventListener("keydown", handleKeyDown);
  store.dispose();
});
</script>

<template>
  <main v-if="!isReady" class="profile-editor">Loading profiles...</main>
  <main v-else-if="store.state.screen === 'home'" class="profile-home">
    <HomePage />
    <StatusBlock v-if="store.state.statusText.length > 0" :text="store.state.statusText" />
  </main>
  <main v-else class="profile-editor">
    <EditorPage />
    <StatusBlock v-if="store.state.statusText.length > 0" :text="store.state.statusText" />
  </main>
</template>
