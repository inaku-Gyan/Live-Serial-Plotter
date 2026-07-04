<script setup lang="ts">
import { useProfileEditorContext } from "../context";
import FramingSection from "./FramingSection.vue";
import IdentitySection from "./IdentitySection.vue";
import OutputsSection from "./OutputsSection.vue";
import ParserSection from "./ParserSection.vue";
import SerialCodecSection from "./SerialCodecSection.vue";

const { store, profile, draft, sourceLabel } = useProfileEditorContext();
</script>

<template>
  <template v-if="profile && draft">
    <header class="profile-editor-toolbar">
      <button class="button button-secondary" type="button" @click="store.backToHome()">
        Back
      </button>
      <div class="profile-editor-title">
        <strong>{{ profile.name }}</strong>
        <span>{{ sourceLabel }}</span>
      </div>
    </header>

    <form class="profile-editor-form">
      <IdentitySection />
      <SerialCodecSection />
      <FramingSection />
      <ParserSection />
      <OutputsSection />
    </form>
  </template>
</template>
