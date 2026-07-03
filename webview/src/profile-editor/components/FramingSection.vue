<script setup lang="ts">
import { useProfileEditorContext } from "../context";

const { draft, isReadonly } = useProfileEditorContext();
</script>

<template>
  <section v-if="draft" class="profile-section">
    <h2>Framing</h2>
    <label class="profile-field">
      <span>Delimiter</span>
      <select v-model="draft.framing.delimiter" name="framing.delimiter" :disabled="isReadonly">
        <option value="auto">auto</option>
        <option value="lf">lf</option>
        <option value="crlf">crlf</option>
        <option value="cr">cr</option>
      </select>
    </label>
    <label class="profile-field">
      <span>Trim frames</span>
      <input
        v-model="draft.framing.trim"
        name="framing.trim"
        type="checkbox"
        :disabled="isReadonly"
      />
    </label>
    <label class="profile-field">
      <span>Max frame bytes</span>
      <input
        v-model="draft.framing.maxFrameBytes"
        name="framing.maxFrameBytes"
        :disabled="isReadonly"
      />
    </label>
  </section>
</template>
