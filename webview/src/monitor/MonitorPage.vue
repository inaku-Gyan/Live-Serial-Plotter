<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type { ToWebviewMessage } from "../../../src/shared/protocol";
import { usePageStore } from "./store";
import ErrorToast from "./components/ErrorToast.vue";
import LayoutControls from "./components/LayoutControls.vue";
import MonitorToolbar from "./components/MonitorToolbar.vue";
import OutputGrid from "./components/OutputGrid.vue";
import SendRow from "./components/SendRow.vue";

const store = usePageStore();

function handleHostMessage(event: MessageEvent<ToWebviewMessage>): void {
  store.handleHostMessage(event.data);
}

onMounted(() => {
  window.addEventListener("message", handleHostMessage);
  store.requestProfiles();
  store.requestPorts();
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleHostMessage);
  store.dispose();
});
</script>

<template>
  <main class="monitor-page">
    <MonitorToolbar />
    <LayoutControls />
    <OutputGrid />
    <SendRow />
    <ErrorToast />
  </main>
</template>
