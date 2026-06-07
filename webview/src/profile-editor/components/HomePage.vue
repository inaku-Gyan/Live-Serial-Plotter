<script setup lang="ts">
import type { ProfileConfig, ProfileSummary } from "../../../../src/shared/protocol";
import type { ProfileEditorStore } from "../store";

defineProps<{
  store: ProfileEditorStore;
}>();

function formatProfileLocation(profile: ProfileSummary): string {
  if (profile.scope === "workspace") {
    return `${profile.id} / ${profile.workspaceName ?? "workspace"}`;
  }

  return `${profile.id} / ${profile.scope}`;
}

function formatParser(profile: ProfileConfig): string {
  if (profile.parser.kind === "script") {
    return `script / ${profile.parser.path}`;
  }

  return `builtin / ${profile.parser.mode}`;
}

function formatOutputs(profile: ProfileConfig): string {
  return profile.outputs.map((output) => `${output.kind}:${output.id}`).join(", ");
}
</script>

<template>
  <section class="profile-section">
    <h2>Profiles</h2>
    <div class="profile-list">
      <article
        v-for="profile in store.state.editorState?.profiles ?? []"
        :key="profile.key"
        class="profile-list-item"
        :data-active="profile.key === store.state.selectedProfileKey ? 'true' : 'false'"
        :data-menu-open="profile.key === store.state.openMenuProfileKey ? 'true' : 'false'"
      >
        <button class="profile-list-main" type="button" @click="store.selectProfile(profile.key)">
          <strong>{{ profile.name }}</strong>
          <span>{{ formatProfileLocation(profile) }}</span>
        </button>
        <div class="profile-list-menu-root">
          <button
            class="profile-menu-trigger"
            type="button"
            :aria-label="`Actions for ${profile.name}`"
            @click.stop="store.toggleProfileMenu(profile.key)"
          >
            ...
          </button>
          <div
            v-if="store.state.openMenuProfileKey === profile.key"
            class="profile-list-menu"
            role="menu"
          >
            <button type="button" role="menuitem" @click.stop="store.openEditor(profile.key)">
              Edit
            </button>
            <button type="button" role="menuitem" @click.stop="store.copyProfile(profile.key)">
              Copy
            </button>
            <button type="button" role="menuitem" @click.stop="store.openProfileJson(profile.key)">
              Open JSONC
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>

  <section v-if="store.state.selectedProfile" class="profile-section">
    <h2>Pipeline</h2>
    <label class="profile-field">
      <span>Profile</span>
      <code>{{ store.state.selectedProfile.name }} / {{ store.state.selectedProfile.id }}</code>
    </label>
    <label class="profile-field">
      <span>Codec</span>
      <code>
        {{ store.state.selectedProfile.codec.kind }} /
        {{ store.state.selectedProfile.codec.encoding }}
      </code>
    </label>
    <label class="profile-field">
      <span>Framing</span>
      <code>
        {{ store.state.selectedProfile.framing.kind }} /
        {{ store.state.selectedProfile.framing.delimiter }}
      </code>
    </label>
    <label class="profile-field">
      <span>Parser</span>
      <code>{{ formatParser(store.state.selectedProfile) }}</code>
    </label>
    <label class="profile-field">
      <span>Outputs</span>
      <code>{{ formatOutputs(store.state.selectedProfile) }}</code>
    </label>
  </section>
</template>
