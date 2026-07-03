<script setup lang="ts">
import { useProfileEditorContext } from "../context";

const { draft, isReadonly, sourceLabel } = useProfileEditorContext();
</script>

<template>
  <section v-if="draft" class="profile-section">
    <h2>Identity</h2>
    <label class="profile-field">
      <span>ID</span>
      <input v-model="draft.id" name="profile.id" disabled />
    </label>
    <label class="profile-field">
      <span>Name</span>
      <input v-model="draft.name" name="profile.name" :disabled="isReadonly" />
    </label>
    <label class="profile-field">
      <span>Source</span>
      <code>{{ sourceLabel }}</code>
    </label>
  </section>
</template>
