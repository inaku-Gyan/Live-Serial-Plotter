<script setup lang="ts">
import { computed } from "vue";
import { useProfileEditorContext } from "../context";

const props = defineProps<{ outputId: string }>();
const { draft, isReadonly } = useProfileEditorContext();

const patch = computed(() =>
  draft.value?.terminalAppendOutputs.find((candidate) => candidate.originalId === props.outputId),
);
</script>

<template>
  <template v-if="patch">
    <label class="profile-field">
      <span>ID</span>
      <input v-model="patch.id" name="output.id" :disabled="isReadonly" />
    </label>
    <label class="profile-field">
      <span>Title</span>
      <input v-model="patch.title" name="output.title" :disabled="isReadonly" />
    </label>
    <label class="profile-field">
      <span>Source</span>
      <select v-model="patch.source" name="output.source" :disabled="isReadonly">
        <option value="raw">raw</option>
        <option value="template">template</option>
      </select>
    </label>
    <label class="profile-field">
      <span>Max lines</span>
      <input v-model="patch.maxLines" name="output.maxLines" :disabled="isReadonly" />
    </label>
    <label class="profile-field">
      <span>Auto scroll</span>
      <input
        v-model="patch.autoScroll"
        name="output.autoScroll"
        type="checkbox"
        :disabled="isReadonly"
      />
    </label>
    <label class="profile-field profile-field-wide">
      <span>Template</span>
      <textarea v-model="patch.template" name="output.template" :disabled="isReadonly" />
    </label>
  </template>
</template>
