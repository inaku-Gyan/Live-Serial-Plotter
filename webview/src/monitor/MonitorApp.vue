<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type { ToWebviewMessage } from "../../../src/shared/protocol";
import { useMonitorStore } from "./store";
import ErrorToast from "./components/ErrorToast.vue";
import LayoutControls from "./components/LayoutControls.vue";
import MonitorToolbar from "./components/MonitorToolbar.vue";
import OutputWorkspace from "./components/OutputWorkspace.vue";
import SendRow from "./components/SendRow.vue";

const store = useMonitorStore();

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
  <main class="shell">
    <MonitorToolbar />
    <LayoutControls />
    <OutputWorkspace />
    <SendRow />
    <ErrorToast />
  </main>
</template>
