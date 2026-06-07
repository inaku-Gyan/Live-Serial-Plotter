<script setup lang="ts">
import { computed } from "vue";
import {
  parserModes,
  type OutputConfig,
  type TerminalAppendOutputConfig,
  type TimeSeriesLineOutputConfig,
} from "../../../../src/shared/protocol";
import type {
  TerminalAppendOutputPatch,
  TimeSeriesOutputPatch,
  TimeSeriesPatch,
} from "../../profileEditorModel";
import type { ProfileEditorStore } from "../store";

const props = defineProps<{
  store: ProfileEditorStore;
}>();

const profile = computed(() => props.store.state.selectedProfile);
const draft = computed(() => props.store.state.draft);
const isReadonly = computed(() => props.store.isBuiltin.value);
const sourceLabel = computed(
  () =>
    props.store.state.selectedSource?.filePath ??
    props.store.state.selectedSource?.workspaceName ??
    props.store.state.selectedSource?.scope ??
    "builtin",
);

function terminalPatch(output: TerminalAppendOutputConfig): TerminalAppendOutputPatch {
  const patch = draft.value?.terminalAppendOutputs.find(
    (candidate) => candidate.originalId === output.id,
  );

  if (patch === undefined) {
    throw new Error(`Missing terminal output patch for ${output.id}.`);
  }

  return patch;
}

function timeSeriesPatch(output: TimeSeriesLineOutputConfig): TimeSeriesOutputPatch {
  const patch = draft.value?.timeSeriesOutputs.find(
    (candidate) => candidate.originalId === output.id,
  );

  if (patch === undefined) {
    throw new Error(`Missing time series output patch for ${output.id}.`);
  }

  return patch;
}

function addSeries(outputPatch: TimeSeriesOutputPatch): void {
  outputPatch.series.push({
    key: "",
    field: "",
    label: "",
    unit: "",
    color: "",
    visible: true,
    scale: "",
    lineWidth: "",
    decimals: "",
  });
}

function removeSeries(outputPatch: TimeSeriesOutputPatch, series: TimeSeriesPatch): void {
  outputPatch.series = outputPatch.series.filter((candidate) => candidate !== series);
}

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
      <section class="profile-section">
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

      <section class="profile-section">
        <h2>Serial Defaults / Codec</h2>
        <label class="profile-field">
          <span>Baud rate</span>
          <input
            v-model="draft.serialDefaults.baudRate"
            name="serialDefaults.baudRate"
            :disabled="isReadonly"
          />
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

      <section class="profile-section">
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

      <section class="profile-section">
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

      <section class="profile-section">
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

          <template v-if="output.kind === 'terminalAppend'">
            <label class="profile-field">
              <span>ID</span>
              <input v-model="terminalPatch(output).id" name="output.id" :disabled="isReadonly" />
            </label>
            <label class="profile-field">
              <span>Title</span>
              <input
                v-model="terminalPatch(output).title"
                name="output.title"
                :disabled="isReadonly"
              />
            </label>
            <label class="profile-field">
              <span>Source</span>
              <select
                v-model="terminalPatch(output).source"
                name="output.source"
                :disabled="isReadonly"
              >
                <option value="raw">raw</option>
                <option value="template">template</option>
              </select>
            </label>
            <label class="profile-field">
              <span>Max lines</span>
              <input
                v-model="terminalPatch(output).maxLines"
                name="output.maxLines"
                :disabled="isReadonly"
              />
            </label>
            <label class="profile-field">
              <span>Auto scroll</span>
              <input
                v-model="terminalPatch(output).autoScroll"
                name="output.autoScroll"
                type="checkbox"
                :disabled="isReadonly"
              />
            </label>
            <label class="profile-field profile-field-wide">
              <span>Template</span>
              <textarea
                v-model="terminalPatch(output).template"
                name="output.template"
                :disabled="isReadonly"
              />
            </label>
          </template>

          <template v-else-if="output.kind === 'timeSeriesLine'">
            <label class="profile-field">
              <span>ID</span>
              <input v-model="timeSeriesPatch(output).id" name="output.id" :disabled="isReadonly" />
            </label>
            <label class="profile-field">
              <span>Title</span>
              <input
                v-model="timeSeriesPatch(output).title"
                name="output.title"
                :disabled="isReadonly"
              />
            </label>
            <div class="profile-grid">
              <label class="profile-field">
                <span>Time source</span>
                <select
                  v-model="timeSeriesPatch(output).time.source"
                  name="time.source"
                  :disabled="isReadonly"
                >
                  <option value="hostReceived">hostReceived</option>
                  <option value="field">field</option>
                  <option value="fixedInterval">fixedInterval</option>
                  <option value="sequence">sequence</option>
                </select>
              </label>
              <label class="profile-field">
                <span>Time field</span>
                <input
                  v-model="timeSeriesPatch(output).time.field"
                  name="time.field"
                  :disabled="isReadonly"
                />
              </label>
              <label class="profile-field">
                <span>Time unit</span>
                <select
                  v-model="timeSeriesPatch(output).time.unit"
                  name="time.unit"
                  :disabled="isReadonly"
                >
                  <option value="s">s</option>
                  <option value="ms">ms</option>
                  <option value="us">us</option>
                </select>
              </label>
              <label class="profile-field">
                <span>Zero</span>
                <select
                  v-model="timeSeriesPatch(output).time.zero"
                  name="time.zero"
                  :disabled="isReadonly"
                >
                  <option value="none">none</option>
                  <option value="first">first</option>
                </select>
              </label>
              <label class="profile-field">
                <span>Interval ms</span>
                <input
                  v-model="timeSeriesPatch(output).time.intervalMs"
                  name="time.intervalMs"
                  :disabled="isReadonly"
                />
              </label>
            </div>
            <label class="profile-field">
              <span>Max points</span>
              <input
                v-model="timeSeriesPatch(output).maxPoints"
                name="output.maxPoints"
                :disabled="isReadonly"
              />
            </label>

            <div class="profile-field profile-field-wide">
              <span>Series</span>
              <div class="series-table">
                <div
                  v-for="series in timeSeriesPatch(output).series"
                  :key="series.key"
                  class="series-row"
                >
                  <label class="profile-field profile-inline-field">
                    <span>Key</span>
                    <input v-model="series.key" name="series.key" :disabled="isReadonly" />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Field</span>
                    <input v-model="series.field" name="series.field" :disabled="isReadonly" />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Label</span>
                    <input v-model="series.label" name="series.label" :disabled="isReadonly" />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Unit</span>
                    <input v-model="series.unit" name="series.unit" :disabled="isReadonly" />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Color</span>
                    <input v-model="series.color" name="series.color" :disabled="isReadonly" />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Scale</span>
                    <input v-model="series.scale" name="series.scale" :disabled="isReadonly" />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Width</span>
                    <input
                      v-model="series.lineWidth"
                      name="series.lineWidth"
                      :disabled="isReadonly"
                    />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Decimals</span>
                    <input
                      v-model="series.decimals"
                      name="series.decimals"
                      :disabled="isReadonly"
                    />
                  </label>
                  <label class="profile-field profile-inline-field">
                    <span>Visible</span>
                    <input
                      v-model="series.visible"
                      name="series.visible"
                      type="checkbox"
                      :disabled="isReadonly"
                    />
                  </label>
                  <button
                    class="button button-secondary"
                    type="button"
                    :disabled="isReadonly"
                    @click="removeSeries(timeSeriesPatch(output), series)"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <button
                class="button button-secondary"
                type="button"
                :disabled="isReadonly"
                @click="addSeries(timeSeriesPatch(output))"
              >
                Add series
              </button>
            </div>
          </template>

          <template v-else>
            <label class="profile-field">
              <span>Status</span>
              <code>Read-only in this editor</code>
            </label>
          </template>
        </article>
      </section>
    </form>
  </template>
</template>
