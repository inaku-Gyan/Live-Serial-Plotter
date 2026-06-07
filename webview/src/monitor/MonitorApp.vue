<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type { ToWebviewMessage } from "../../../src/shared/protocol";
import type { MonitorStore } from "./store";
import ErrorToast from "./components/ErrorToast.vue";
import LayoutControls from "./components/LayoutControls.vue";
import MonitorToolbar from "./components/MonitorToolbar.vue";
import OutputWorkspace from "./components/OutputWorkspace.vue";
import SendRow from "./components/SendRow.vue";

const props = defineProps<{
  store: MonitorStore;
}>();

function handleHostMessage(event: MessageEvent<ToWebviewMessage>): void {
  props.store.handleHostMessage(event.data);
}

onMounted(() => {
  window.addEventListener("message", handleHostMessage);
  props.store.requestProfiles();
  props.store.requestPorts();
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleHostMessage);
  props.store.dispose();
});
</script>

<template>
  <main class="shell">
    <MonitorToolbar :store="store" />
    <LayoutControls :store="store" />
    <OutputWorkspace :store="store" />
    <SendRow :store="store" />
    <ErrorToast :store="store" />
  </main>
</template>
