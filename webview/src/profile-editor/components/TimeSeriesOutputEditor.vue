<script setup lang="ts">
import { computed } from "vue";
import { useProfileEditorContext } from "../context";

const props = defineProps<{ outputId: string }>();
const { draft, isReadonly } = useProfileEditorContext();

const patch = computed(() =>
  draft.value?.timeSeriesOutputs.find((candidate) => candidate.originalId === props.outputId),
);

function addSeries(): void {
  patch.value?.series.push({
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

function removeSeries(index: number): void {
  patch.value?.series.splice(index, 1);
}
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
    <div class="profile-grid">
      <label class="profile-field">
        <span>Time source</span>
        <select v-model="patch.time.source" name="time.source" :disabled="isReadonly">
          <option value="hostReceived">hostReceived</option>
          <option value="field">field</option>
          <option value="fixedInterval">fixedInterval</option>
          <option value="sequence">sequence</option>
        </select>
      </label>
      <label class="profile-field">
        <span>Time field</span>
        <input v-model="patch.time.field" name="time.field" :disabled="isReadonly" />
      </label>
      <label class="profile-field">
        <span>Time unit</span>
        <select v-model="patch.time.unit" name="time.unit" :disabled="isReadonly">
          <option value="s">s</option>
          <option value="ms">ms</option>
          <option value="us">us</option>
        </select>
      </label>
      <label class="profile-field">
        <span>Zero</span>
        <select v-model="patch.time.zero" name="time.zero" :disabled="isReadonly">
          <option value="none">none</option>
          <option value="first">first</option>
        </select>
      </label>
      <label class="profile-field">
        <span>Interval ms</span>
        <input v-model="patch.time.intervalMs" name="time.intervalMs" :disabled="isReadonly" />
      </label>
    </div>
    <label class="profile-field">
      <span>Max points</span>
      <input v-model="patch.maxPoints" name="output.maxPoints" :disabled="isReadonly" />
    </label>

    <div class="profile-field profile-field-wide">
      <span>Series</span>
      <div class="series-table">
        <div v-for="(series, index) in patch.series" :key="index" class="series-row">
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
            <input v-model="series.lineWidth" name="series.lineWidth" :disabled="isReadonly" />
          </label>
          <label class="profile-field profile-inline-field">
            <span>Decimals</span>
            <input v-model="series.decimals" name="series.decimals" :disabled="isReadonly" />
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
            @click="removeSeries(index)"
          >
            Remove
          </button>
        </div>
      </div>
      <button
        class="button button-secondary"
        type="button"
        :disabled="isReadonly"
        @click="addSeries()"
      >
        Add series
      </button>
    </div>
  </template>
</template>
