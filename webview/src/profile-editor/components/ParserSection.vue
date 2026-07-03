<script setup lang="ts">
import { parserModes } from "../../../../src/shared/protocol";
import { useProfileEditorContext } from "../context";

const { profile, draft, isReadonly } = useProfileEditorContext();
</script>

<template>
  <section v-if="profile && draft" class="profile-section">
    <h2>Parser</h2>
    <template v-if="profile.parser.kind === 'script'">
      <label class="profile-field">
        <span>Kind</span>
        <code>script</code>
      </label>
      <label class="profile-field">
        <span>Path</span>
        <code>{{ profile.parser.path }}</code>
      </label>
      <label class="profile-field">
        <span>Options</span>
        <code>{{ JSON.stringify(profile.parser.options ?? {}, null, 2) }}</code>
      </label>
    </template>
    <template v-else-if="draft.builtinParser">
      <label class="profile-field">
        <span>Mode</span>
        <select v-model="draft.builtinParser.mode" name="parser.mode" :disabled="isReadonly">
          <option v-for="mode in parserModes" :key="mode" :value="mode">{{ mode }}</option>
        </select>
      </label>
      <label class="profile-field profile-field-wide">
        <span>Options JSON</span>
        <textarea
          v-model="draft.builtinParser.optionsJson"
          name="parser.options"
          :disabled="isReadonly"
        />
      </label>
    </template>
  </section>
</template>
