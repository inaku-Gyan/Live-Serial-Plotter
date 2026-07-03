<script setup lang="ts">
import { baudRatePresets } from "../../baudRate";
import { parserModes, type ParserMode, type ProfileSummary } from "../../../../src/shared/protocol";
import { usePageStore } from "../store";

const store = usePageStore();
const {
  state,
  baudRateValid,
  connectionStatusText,
  portSelectDisabled,
  parserModeSelectDisabled,
  connectDisabled,
} = store;

function handleProfileChange(event: Event): void {
  const target = event.target;

  if (target instanceof HTMLSelectElement) {
    store.selectProfile(target.value);
  }
}

function handlePortChange(event: Event): void {
  const target = event.target;

  if (target instanceof HTMLSelectElement) {
    store.setSelectedPath(target.value);
  }
}

function handleBaudInput(event: Event): void {
  const target = event.target;

  if (target instanceof HTMLInputElement) {
    store.setBaudRateInput(target.value);
  }
}

function handleParserChange(event: Event): void {
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
        :value="state.profileKey"
        :disabled="state.connected"
        @change="handleProfileChange($event)"
      >
        <option v-for="profile in state.profiles" :key="profile.key" :value="profile.key">
          {{ formatProfileSummary(profile) }}
        </option>
      </select>
    </label>
    <label class="field field-wide">
      <span>Port</span>
      <select
        :value="state.selectedPath"
        :disabled="portSelectDisabled"
        @change="handlePortChange($event)"
      >
        <option v-if="state.ports.length === 0" value="">No ports found</option>
        <option v-for="port in state.ports" :key="port.path" :value="port.path">
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
        :value="state.baudRateInput"
        type="number"
        min="1"
        step="1"
        inputmode="numeric"
        list="baudRatePresets"
        autocomplete="off"
        :disabled="state.connected"
        :aria-invalid="baudRateValid ? 'false' : 'true'"
        @input="handleBaudInput($event)"
        @change="handleBaudInput($event)"
      />
      <datalist id="baudRatePresets">
        <option v-for="baudRate in baudRatePresets" :key="baudRate" :value="String(baudRate)" />
      </datalist>
    </label>
    <label class="field">
      <span>Parser</span>
      <select
        :value="state.parserMode"
        :disabled="parserModeSelectDisabled"
        @change="handleParserChange($event)"
      >
        <option v-for="parserMode in parserModes" :key="parserMode" :value="parserMode">
          {{ formatParserMode(parserMode) }}
        </option>
      </select>
    </label>
    <button
      class="button"
      :class="state.connected ? 'button-secondary' : 'button-primary'"
      type="button"
      :disabled="connectDisabled"
      @click="store.toggleConnection()"
    >
      {{ state.connected ? "Disconnect" : "Connect" }}
    </button>
    <span class="status" :class="{ 'status-connected': state.connected }" aria-live="polite">
      {{ connectionStatusText }}
    </span>
  </header>
</template>
