import { computed } from "vue";
import { useProfileEditorStore } from "./store";

/** Shared editor derivations used by the profile editor form sections. */
export function useProfileEditorContext() {
  const store = useProfileEditorStore();
  const profile = computed(() => store.state.selectedProfile);
  const draft = computed(() => store.state.draft);
  const isReadonly = computed(() => store.isBuiltin.value);
  const sourceLabel = computed(
    () =>
      store.state.selectedSource?.filePath ??
      store.state.selectedSource?.workspaceName ??
      store.state.selectedSource?.scope ??
      "builtin",
  );

  return { store, profile, draft, isReadonly, sourceLabel };
}
