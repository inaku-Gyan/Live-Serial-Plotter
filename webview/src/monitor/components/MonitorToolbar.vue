<script setup lang="ts">
import { baudRatePresets } from "../../baudRate";
import { parserModes, type ParserMode, type ProfileSummary } from "../../../../src/shared/protocol";
import type { MonitorStore } from "../store";

defineProps<{
  store: MonitorStore;
}>();

function handleProfileChange(store: MonitorStore, event: Event): void {
  const target = event.target;

  if (target instanceof HTMLSelectElement) {
    store.selectProfile(target.value);
  }
}

function handlePortChange(store: MonitorStore, event: Event): void {
  const target = event.target;

  if (target instanceof HTMLSelectElement) {
    store.setSelectedPath(target.value);
  }
}

function handleBaudInput(store: MonitorStore, event: Event): void {
  const target = event.target;

  if (target instanceof HTMLInputElement) {
    store.setBaudRateInput(target.value);
  }
}

function handleParserChange(store: MonitorStore, event: Event): void {
  const target = event.target;

  if (target instanceof HTMLSelectElement) {
    store.setParserMode(target.value);
  }
}

function formatProfileSummary(profile: ProfileSummary): string {
  if (profile.scope === "workspace") {
    const workspace = profile.workspaceName ?? "workspace";
    return `${profile.name} (${workspace})`;
  }

  return `${profile.name} (${profile.scope})`;
}

function formatParserMode(parserMode: ParserMode): string {
  if (parserMode === "jsonl") {
    return "JSON Lines";
  }

  if (parserMode === "keyValue") {
    return "Key=Value";
  }

  return parserMode.toUpperCase();
}
</script>

<template>
  <header class="toolbar">
    <label class="field">
      <span>Profile</span>
      <select
        :value="store.state.profileKey"
        :disabled="store.state.connected"
        @change="handleProfileChange(store, $event)"
      >
        <option v-for="profile in store.state.profiles" :key="profile.key" :value="profile.key">
          {{ formatProfileSummary(profile) }}
        </option>
      </select>
    </label>
    <label class="field field-wide">
      <span>Port</span>
      <select
        :value="store.state.selectedPath"
        :disabled="store.portSelectDisabled.value"
        @change="handlePortChange(store, $event)"
      >
        <option v-if="store.state.ports.length === 0" value="">No ports found</option>
        <option v-for="port in store.state.ports" :key="port.path" :value="port.path">
          {{ port.manufacturer === undefined ? port.path : `${port.path} (${port.manufacturer})` }}
        </option>
      </select>
    </label>
    <button class="button button-secondary" type="button" @click="store.requestPorts()">
      Refresh
    </button>
    <label class="field">
      <span>Baud</span>
      <input
        :value="store.state.baudRateInput"
        type="number"
        min="1"
        step="1"
        inputmode="numeric"
        list="baudRatePresets"
        autocomplete="off"
        :disabled="store.state.connected"
        :aria-invalid="store.baudRateValid.value ? 'false' : 'true'"
        @input="handleBaudInput(store, $event)"
        @change="handleBaudInput(store, $event)"
      />
      <datalist id="baudRatePresets">
        <option v-for="baudRate in baudRatePresets" :key="baudRate" :value="String(baudRate)" />
      </datalist>
    </label>
    <label class="field">
      <span>Parser</span>
      <select
        :value="store.state.parserMode"
        :disabled="store.parserModeSelectDisabled.value"
        @change="handleParserChange(store, $event)"
      >
        <option v-for="parserMode in parserModes" :key="parserMode" :value="parserMode">
          {{ formatParserMode(parserMode) }}
        </option>
      </select>
    </label>
    <button
      class="button"
      :class="store.state.connected ? 'button-secondary' : 'button-primary'"
      type="button"
      :disabled="store.connectDisabled.value"
      @click="store.toggleConnection()"
    >
      {{ store.state.connected ? "Disconnect" : "Connect" }}
    </button>
    <span class="status" :class="{ 'status-connected': store.state.connected }" aria-live="polite">
      {{ store.connectionStatusText.value }}
    </span>
  </header>
</template>
