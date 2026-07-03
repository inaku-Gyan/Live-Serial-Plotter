<script setup lang="ts">
import type { OutputConfig } from "../../../../src/shared/protocol";
import { useProfileEditorContext } from "../context";
import TerminalOutputEditor from "./TerminalOutputEditor.vue";
import TimeSeriesOutputEditor from "./TimeSeriesOutputEditor.vue";

const { profile } = useProfileEditorContext();

function outputTitle(output: OutputConfig): string {
  if (output.kind === "terminalAppend") {
    return `Terminal: ${output.id}`;
  }

  if (output.kind === "timeSeriesLine") {
    return `Time Series: ${output.id}`;
  }

  return `${output.id} (${output.kind})`;
}
</script>

<template>
  <section v-if="profile" class="profile-section">
    <h2>Outputs</h2>
    <article
      v-for="output in profile.outputs"
      :key="output.id"
      class="profile-output"
      :class="{
        'profile-output-readonly':
          output.kind !== 'terminalAppend' && output.kind !== 'timeSeriesLine',
      }"
    >
      <h2>{{ outputTitle(output) }}</h2>
      <TerminalOutputEditor v-if="output.kind === 'terminalAppend'" :output-id="output.id" />
      <TimeSeriesOutputEditor v-else-if="output.kind === 'timeSeriesLine'" :output-id="output.id" />
      <template v-else>
        <label class="profile-field">
          <span>Status</span>
          <code>Read-only in this editor</code>
        </label>
      </template>
    </article>
  </section>
</template>
