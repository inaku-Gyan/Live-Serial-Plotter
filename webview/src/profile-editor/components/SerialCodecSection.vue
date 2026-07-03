<script setup lang="ts">
import { baudRatePresets, isBaudRateInputValid } from "../../baudRate";
import { useProfileEditorContext } from "../context";

const { profile, draft, isReadonly } = useProfileEditorContext();
</script>

<template>
  <section v-if="profile && draft" class="profile-section">
    <h2>Serial Defaults / Codec</h2>
    <label class="profile-field">
      <span>Baud rate</span>
      <input
        v-model="draft.serialDefaults.baudRate"
        name="serialDefaults.baudRate"
        type="number"
        min="1"
        step="1"
        inputmode="numeric"
        list="profileBaudRatePresets"
        :aria-invalid="isBaudRateInputValid(draft.serialDefaults.baudRate) ? 'false' : 'true'"
        :disabled="isReadonly"
      />
      <datalist id="profileBaudRatePresets">
        <option
          v-for="baudRate in baudRatePresets"
          :key="baudRate"
          :value="String(baudRate)"
        ></option>
      </datalist>
    </label>
    <label class="profile-field">
      <span>Encoding</span>
      <code>{{ profile.codec.encoding }}</code>
    </label>
    <label class="profile-field">
      <span>Send line ending</span>
      <select
        v-model="draft.codec.sendLineEnding"
        name="codec.sendLineEnding"
        :disabled="isReadonly"
      >
        <option value="none">none</option>
        <option value="lf">lf</option>
        <option value="crlf">crlf</option>
        <option value="cr">cr</option>
      </select>
    </label>
  </section>
</template>
