import "./profileEditor.css";
import {
  parserModes,
  type LineEnding,
  type ParserMode,
  type ProfileConfig,
  type ProfileEditorState,
  type ProfileSummary,
  type ProfileSourceMetadata,
  type TerminalAppendOutputConfig,
  type TimeSeriesLineOutputConfig,
  type ToProfileEditorMessage,
  type ToProfileEditorWebviewMessage,
} from "../../src/shared/protocol";
import {
  applyProfileEditorPatch,
  type ProfileEditorPatch,
  type TerminalAppendOutputPatch,
  type TimeAxisPatch,
  type TimeSeriesOutputPatch,
  type TimeSeriesPatch,
} from "./profileEditorModel";

interface VsCodeApi<State> {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: ToProfileEditorMessage): void;
}

type ProfileEditorView = "home" | "editor";

interface PersistedState {
  selectedProfileKey?: string;
  view?: ProfileEditorView;
}

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

const vscode = acquireVsCodeApi<PersistedState>();
const root = requireElement(document, "#profileApp");
let editorState: ProfileEditorState | undefined;
let selectedProfile: ProfileConfig | undefined;
let selectedProfileKey: string | undefined;
let selectedSource: ProfileSourceMetadata | undefined;
let currentView: ProfileEditorView = vscode.getState()?.view ?? "home";
let statusText = "";
let statusElement: HTMLPreElement | undefined;
let autoSaveTimer: number | undefined;

renderLoading();
postMessage({
  type: "requestProfileEditorState",
  profileKey: vscode.getState()?.selectedProfileKey,
});

window.addEventListener("message", (event: MessageEvent<ToProfileEditorWebviewMessage>) => {
  const message = event.data;

  if (message.type === "profileEditorState") {
    editorState = message.state;
    selectedProfile = cloneProfile(message.state.selectedProfile);
    selectedProfileKey = message.state.selectedProfileKey;
    selectedSource = message.state.selectedSource;
    persistState();
    statusText = message.state.errors.join("\n");
    renderCurrentView();
    return;
  }

  if (message.type === "requestCopyProfile") {
    copyCurrentProfile();
    return;
  }

  if (message.type === "profileAutoSaved") {
    selectedProfileKey = message.profileKey;
    persistState();
    setStatusText(`Saved to ${message.filePath}`);
    return;
  }

  if (message.type === "profileCopied") {
    currentView = "editor";
    selectedProfileKey = message.profileKey;
    persistState();
    setStatusText(`Copied to ${message.filePath}`);
    return;
  }

  statusText = message.message;
  renderCurrentView();
});

function renderLoading(): void {
  root.innerHTML = "";
  const container = document.createElement("main");
  container.className = "profile-editor";
  container.textContent = "Loading profiles...";
  root.append(container);
}

function renderCurrentView(): void {
  if (currentView === "editor") {
    renderEditor();
    return;
  }

  renderHome();
}

function renderHome(): void {
  if (editorState === undefined || selectedProfile === undefined) {
    renderLoading();
    return;
  }

  root.innerHTML = "";
  statusElement = undefined;

  const container = document.createElement("main");
  container.className = "profile-home";
  container.append(renderHomeToolbar(), renderProfileList(), renderPipelinePreview());

  if (statusText.length > 0) {
    appendStatus(container);
  }

  root.append(container);
}

function renderHomeToolbar(): HTMLElement {
  const toolbar = document.createElement("header");
  toolbar.className = "profile-home-toolbar";
  toolbar.append(
    createButton("Refresh", () => postMessage({ type: "requestProfileEditorState" })),
    createButton("Copy Profile", () => copyCurrentProfile(), "button-primary"),
    createButton("Open JSONC", () => postMessage({ type: "openProfileJson" })),
  );
  return toolbar;
}

function renderProfileList(): HTMLElement {
  const section = createSection("Profiles");
  const list = document.createElement("div");
  list.className = "profile-list";

  for (const profile of editorState?.profiles ?? []) {
    const item = document.createElement("button");
    item.className = "profile-list-item";
    item.type = "button";
    item.dataset.active = profile.key === selectedProfileKey ? "true" : "false";
    item.addEventListener("click", () => selectProfileOnHome(profile.key));

    const title = document.createElement("strong");
    title.textContent = profile.name;

    const meta = document.createElement("span");
    meta.textContent = formatProfileLocation(profile);

    item.append(title, meta);
    list.append(item);
  }

  section.append(list);
  return section;
}

function renderPipelinePreview(): HTMLElement {
  const profile = requireSelectedProfile();
  const section = createSection("Pipeline");
  section.append(
    createReadonlyLine("Profile", `${profile.name} / ${profile.id}`),
    createReadonlyLine("Codec", `${profile.codec.kind} / ${profile.codec.encoding}`),
    createReadonlyLine("Framing", `${profile.framing.kind} / ${profile.framing.delimiter}`),
    createReadonlyLine("Parser", formatParser(profile)),
    createReadonlyLine("Outputs", formatOutputs(profile)),
  );

  const actions = document.createElement("div");
  actions.className = "profile-home-actions";
  actions.append(
    createButton("Edit", () => openEditor(selectedProfileKey), "button-primary"),
    createButton("Copy", () => copyCurrentProfile()),
    createButton("Open JSONC", () => postMessage({ type: "openProfileJson" })),
  );
  section.append(actions);
  return section;
}

function renderEditor(): void {
  if (editorState === undefined || selectedProfile === undefined) {
    renderLoading();
    return;
  }

  root.innerHTML = "";
  statusElement = undefined;

  const container = document.createElement("main");
  container.className = "profile-editor";
  container.addEventListener("input", scheduleAutoSave);
  container.addEventListener("change", scheduleAutoSave);
  container.append(
    renderToolbar(),
    renderIdentity(),
    renderSerialDefaultsAndCodec(),
    renderFraming(),
    renderParser(),
  );

  const outputsSection = document.createElement("section");
  outputsSection.className = "profile-section";
  outputsSection.append(
    renderSectionTitle("Outputs"),
    ...selectedProfile.outputs.map(renderOutput),
  );
  container.append(outputsSection);

  if (statusText.length > 0) {
    appendStatus(container);
  }

  applyReadonlyState(container);

  root.append(container);
}

function renderToolbar(): HTMLElement {
  const toolbar = document.createElement("header");
  toolbar.className = "profile-editor-toolbar";

  const profileSelect = document.createElement("select");
  profileSelect.id = "profileId";

  for (const profile of editorState?.profiles ?? []) {
    const option = document.createElement("option");
    option.value = profile.key;
    option.textContent = formatProfileSummary(profile);
    profileSelect.append(option);
  }

  profileSelect.value = selectedProfileKey ?? "";
  profileSelect.addEventListener("change", () => {
    selectedProfileKey = profileSelect.value;
    persistState();
    postMessage({ type: "selectProfileForEdit", profileKey: profileSelect.value });
  });

  toolbar.append(
    createButton("Back", () => {
      currentView = "home";
      persistState();
      renderHome();
    }),
    profileSelect,
    createButton("Refresh", () => postMessage({ type: "requestProfileEditorState" })),
    createButton("Copy Profile", () => copyCurrentProfile(), "button-primary"),
    createButton("Open JSONC", () => postMessage({ type: "openProfileJson" })),
  );
  return toolbar;
}

function renderIdentity(): HTMLElement {
  const section = createSection("Identity");
  section.append(
    createInputField("ID", "profile.id", selectedProfile?.id ?? ""),
    createInputField("Name", "profile.name", selectedProfile?.name ?? ""),
    createReadonlyLine("Source", selectedSource?.filePath ?? selectedSource?.scope ?? "builtin"),
  );
  return section;
}

function applyReadonlyState(container: HTMLElement): void {
  const isBuiltin = selectedSource?.scope === "builtin";

  for (const field of container.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("[name]")) {
    if (field.name === "profile.id") {
      field.disabled = true;
      continue;
    }

    field.disabled = isBuiltin;
  }
}

function renderSerialDefaultsAndCodec(): HTMLElement {
  const section = createSection("Serial Defaults / Codec");
  const profile = requireSelectedProfile();
  section.append(
    createInputField(
      "Baud rate",
      "serialDefaults.baudRate",
      profile.serialDefaults?.baudRate === undefined ? "" : String(profile.serialDefaults.baudRate),
    ),
    createReadonlyLine("Encoding", profile.codec.encoding),
    createSelectField(
      "Send line ending",
      "codec.sendLineEnding",
      profile.codec.sendLineEnding ?? "none",
      ["none", "lf", "crlf", "cr"],
    ),
  );
  return section;
}

function renderFraming(): HTMLElement {
  const section = createSection("Framing");
  const profile = requireSelectedProfile();
  section.append(
    createSelectField("Delimiter", "framing.delimiter", profile.framing.delimiter, [
      "auto",
      "lf",
      "crlf",
      "cr",
    ]),
    createCheckboxField("Trim frames", "framing.trim", profile.framing.trim === true),
    createInputField(
      "Max frame bytes",
      "framing.maxFrameBytes",
      profile.framing.maxFrameBytes === undefined ? "" : String(profile.framing.maxFrameBytes),
    ),
  );
  return section;
}

function renderParser(): HTMLElement {
  const section = createSection("Parser");
  const profile = requireSelectedProfile();

  if (profile.parser.kind === "script") {
    section.append(
      createReadonlyLine("Kind", "script"),
      createReadonlyLine("Path", profile.parser.path),
      createReadonlyLine("Options", JSON.stringify(profile.parser.options ?? {}, null, 2)),
    );
    return section;
  }

  const modeSelect = createSelectField("Mode", "parser.mode", profile.parser.mode, [
    ...parserModes,
  ]);
  const optionsField = createTextareaField(
    "Options JSON",
    "parser.options",
    profile.parser.options === undefined ? "" : JSON.stringify(profile.parser.options, null, 2),
  );
  section.append(modeSelect, optionsField);
  return section;
}

function renderOutput(output: ProfileConfig["outputs"][number]): HTMLElement {
  if (output.kind === "terminalAppend") {
    return renderTerminalAppendOutput(output);
  }

  if (output.kind === "timeSeriesLine") {
    return renderTimeSeriesOutput(output);
  }

  const unsupported = document.createElement("article");
  unsupported.className = "profile-output profile-output-readonly";
  unsupported.append(
    renderSectionTitle(`${output.id} (${output.kind})`),
    createReadonlyLine("Status", "Read-only in this editor"),
  );
  return unsupported;
}

function renderTerminalAppendOutput(output: TerminalAppendOutputConfig): HTMLElement {
  const article = document.createElement("article");
  article.className = "profile-output";
  article.dataset.outputKind = output.kind;
  article.dataset.originalId = output.id;
  article.append(
    renderSectionTitle(`Terminal: ${output.id}`),
    createInputField("ID", "output.id", output.id),
    createInputField("Title", "output.title", output.title ?? ""),
    createSelectField("Source", "output.source", output.source ?? "raw", ["raw", "template"]),
    createInputField(
      "Max lines",
      "output.maxLines",
      output.maxLines === undefined ? "" : String(output.maxLines),
    ),
    createCheckboxField("Auto scroll", "output.autoScroll", output.autoScroll !== false),
    createTextareaField("Template", "output.template", output.template ?? ""),
  );
  return article;
}

function renderTimeSeriesOutput(output: TimeSeriesLineOutputConfig): HTMLElement {
  const article = document.createElement("article");
  article.className = "profile-output";
  article.dataset.outputKind = output.kind;
  article.dataset.originalId = output.id;
  article.append(
    renderSectionTitle(`Time Series: ${output.id}`),
    createInputField("ID", "output.id", output.id),
    createInputField("Title", "output.title", output.title ?? ""),
    renderTimeAxis(output),
    createInputField(
      "Max points",
      "output.maxPoints",
      output.window?.maxPoints === undefined ? "" : String(output.window.maxPoints),
    ),
    renderSeriesTable(output),
  );
  return article;
}

function renderTimeAxis(output: TimeSeriesLineOutputConfig): HTMLElement {
  const group = document.createElement("div");
  group.className = "profile-grid";
  const time = output.time;
  const source = time.source;
  group.append(
    createSelectField("Time source", "time.source", source, [
      "hostReceived",
      "field",
      "fixedInterval",
      "sequence",
    ]),
    createInputField("Time field", "time.field", source === "field" ? time.field : ""),
    createSelectField(
      "Time unit",
      "time.unit",
      source === "fixedInterval" || source === "sequence" ? "ms" : (time.unit ?? "s"),
      ["s", "ms", "us"],
    ),
    createSelectField(
      "Zero",
      "time.zero",
      source === "fixedInterval" || source === "sequence" ? "none" : (time.zero ?? "first"),
      ["none", "first"],
    ),
    createInputField(
      "Interval ms",
      "time.intervalMs",
      source === "fixedInterval" ? String(time.intervalMs) : "",
    ),
  );
  return group;
}

function renderSeriesTable(output: TimeSeriesLineOutputConfig): HTMLElement {
  const table = document.createElement("div");
  table.className = "series-table";
  table.dataset.seriesTable = "true";

  for (const [key, series] of Object.entries(output.series)) {
    table.append(
      renderSeriesRow({
        key,
        field: series.field,
        label: series.label ?? "",
        unit: series.unit ?? "",
        color: series.color ?? "",
        visible: series.visible !== false,
        scale: series.scale === undefined ? "" : String(series.scale),
        lineWidth: series.line?.width === undefined ? "" : String(series.line.width),
        decimals: series.format?.decimals === undefined ? "" : String(series.format.decimals),
      }),
    );
  }

  const addButton = createButton("Add series", () => {
    table.append(
      renderSeriesRow({
        key: "",
        field: "",
        label: "",
        unit: "",
        color: "",
        visible: true,
        scale: "",
        lineWidth: "",
        decimals: "",
      }),
    );
  });
  const wrapper = document.createElement("div");
  wrapper.className = "profile-field profile-field-wide";
  wrapper.append(createFieldLabel("Series"), table, addButton);
  return wrapper;
}

function renderSeriesRow(series: TimeSeriesPatch): HTMLElement {
  const row = document.createElement("div");
  row.className = "series-row";
  row.append(
    createInlineInput("Key", "series.key", series.key),
    createInlineInput("Field", "series.field", series.field),
    createInlineInput("Label", "series.label", series.label),
    createInlineInput("Unit", "series.unit", series.unit),
    createInlineInput("Color", "series.color", series.color),
    createInlineInput("Scale", "series.scale", series.scale),
    createInlineInput("Width", "series.lineWidth", series.lineWidth),
    createInlineInput("Decimals", "series.decimals", series.decimals),
    createInlineCheckbox("Visible", "series.visible", series.visible),
    createButton("Remove", () => row.remove(), "button-secondary"),
  );
  return row;
}

function copyCurrentProfile(): void {
  if (selectedProfile === undefined) {
    return;
  }

  try {
    const profile =
      currentView === "editor"
        ? applyProfileEditorPatch(selectedProfile, collectPatch())
        : selectedProfile;
    postMessage({
      type: "copyProfile",
      profile,
    });
  } catch (error) {
    setStatusText(error instanceof Error ? error.message : String(error));
  }
}

function scheduleAutoSave(event: Event): void {
  if (selectedSource?.scope === "builtin") {
    return;
  }

  const target = event.target;

  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    )
  ) {
    return;
  }

  if (target.name.length === 0 || target.name === "profile.id") {
    return;
  }

  if (autoSaveTimer !== undefined) {
    window.clearTimeout(autoSaveTimer);
  }

  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = undefined;
    autoSaveCurrentProfile();
  }, 350);
}

function autoSaveCurrentProfile(): void {
  if (selectedProfile === undefined || selectedSource?.scope === "builtin") {
    return;
  }

  try {
    const nextProfile = applyProfileEditorPatch(selectedProfile, collectPatch());
    selectedProfile = nextProfile;
    setStatusText("Saving...");
    postMessage({
      type: "autoSaveProfile",
      profile: nextProfile,
    });
  } catch (error) {
    setStatusText(error instanceof Error ? error.message : String(error));
  }
}

function setStatusText(text: string): void {
  statusText = text;

  if (statusElement !== undefined) {
    statusElement.textContent = text;
    return;
  }

  const status = document.createElement("pre");
  status.className = "profile-status";
  status.textContent = text;
  statusElement = status;
  root.querySelector("main")?.append(status);
}

function appendStatus(container: HTMLElement): void {
  const status = document.createElement("pre");
  status.className = "profile-status";
  status.textContent = statusText;
  statusElement = status;
  container.append(status);
}

function selectProfileOnHome(profileKey: string): void {
  selectedProfileKey = profileKey;
  persistState();
  postMessage({ type: "selectProfileForEdit", profileKey });
}

function openEditor(profileKey: string | undefined): void {
  currentView = "editor";
  persistState();

  if (profileKey !== undefined && profileKey !== selectedProfileKey) {
    selectedProfileKey = profileKey;
    renderLoading();
    postMessage({ type: "selectProfileForEdit", profileKey });
    return;
  }

  renderEditor();
}

function formatProfileSummary(profile: ProfileSummary): string {
  if (profile.scope === "workspace") {
    const workspaceName = profile.workspaceName ?? "workspace";
    return `${profile.name} (${workspaceName})`;
  }

  return `${profile.name} (${profile.scope})`;
}

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

function persistState(): void {
  vscode.setState({ selectedProfileKey, view: currentView });
}

function collectPatch(): ProfileEditorPatch {
  const profile = requireSelectedProfile();
  return {
    id: getInputValue("profile.id"),
    name: getInputValue("profile.name"),
    serialDefaults: {
      baudRate: getInputValue("serialDefaults.baudRate"),
    },
    codec: {
      sendLineEnding: getSelectValue("codec.sendLineEnding") as LineEnding,
    },
    framing: {
      delimiter: getSelectValue("framing.delimiter") as "auto" | "lf" | "crlf" | "cr",
      trim: getCheckboxValue("framing.trim"),
      maxFrameBytes: getInputValue("framing.maxFrameBytes"),
    },
    builtinParser:
      profile.parser.kind === "builtin"
        ? {
            mode: getSelectValue("parser.mode") as ParserMode,
            optionsJson: getInputValue("parser.options"),
          }
        : undefined,
    terminalAppendOutputs: collectTerminalOutputs(),
    timeSeriesOutputs: collectTimeSeriesOutputs(),
  };
}

function collectTerminalOutputs(): TerminalAppendOutputPatch[] {
  return queryAll<HTMLElement>('[data-output-kind="terminalAppend"]').map((output) => ({
    originalId: output.dataset.originalId ?? "",
    id: getScopedInputValue(output, "output.id"),
    title: getScopedInputValue(output, "output.title"),
    source: getScopedSelectValue(output, "output.source") as "raw" | "template",
    template: getScopedInputValue(output, "output.template"),
    maxLines: getScopedInputValue(output, "output.maxLines"),
    autoScroll: getScopedCheckboxValue(output, "output.autoScroll"),
  }));
}

function collectTimeSeriesOutputs(): TimeSeriesOutputPatch[] {
  return queryAll<HTMLElement>('[data-output-kind="timeSeriesLine"]').map((output) => ({
    originalId: output.dataset.originalId ?? "",
    id: getScopedInputValue(output, "output.id"),
    title: getScopedInputValue(output, "output.title"),
    time: collectTimeAxis(output),
    maxPoints: getScopedInputValue(output, "output.maxPoints"),
    series: collectSeries(output),
  }));
}

function collectTimeAxis(output: HTMLElement): TimeAxisPatch {
  return {
    source: getScopedSelectValue(output, "time.source") as TimeAxisPatch["source"],
    field: getScopedInputValue(output, "time.field"),
    unit: getScopedSelectValue(output, "time.unit") as TimeAxisPatch["unit"],
    zero: getScopedSelectValue(output, "time.zero") as TimeAxisPatch["zero"],
    intervalMs: getScopedInputValue(output, "time.intervalMs"),
  };
}

function collectSeries(output: HTMLElement): TimeSeriesPatch[] {
  return queryAll<HTMLElement>(".series-row", output).map((row) => ({
    key: getScopedInputValue(row, "series.key"),
    field: getScopedInputValue(row, "series.field"),
    label: getScopedInputValue(row, "series.label"),
    unit: getScopedInputValue(row, "series.unit"),
    color: getScopedInputValue(row, "series.color"),
    visible: getScopedCheckboxValue(row, "series.visible"),
    scale: getScopedInputValue(row, "series.scale"),
    lineWidth: getScopedInputValue(row, "series.lineWidth"),
    decimals: getScopedInputValue(row, "series.decimals"),
  }));
}

function createSection(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "profile-section";
  section.append(renderSectionTitle(title));
  return section;
}

function renderSectionTitle(title: string): HTMLElement {
  const heading = document.createElement("h2");
  heading.textContent = title;
  return heading;
}

function createInputField(label: string, name: string, value: string): HTMLElement {
  const wrapper = createFieldWrapper(label);
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  wrapper.append(input);
  return wrapper;
}

function createInlineInput(label: string, name: string, value: string): HTMLElement {
  const wrapper = createFieldWrapper(label);
  wrapper.classList.add("profile-inline-field");
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  wrapper.append(input);
  return wrapper;
}

function createTextareaField(label: string, name: string, value: string): HTMLElement {
  const wrapper = createFieldWrapper(label);
  wrapper.classList.add("profile-field-wide");
  const textarea = document.createElement("textarea");
  textarea.name = name;
  textarea.value = value;
  wrapper.append(textarea);
  return wrapper;
}

function createSelectField(
  label: string,
  name: string,
  value: string,
  options: readonly string[],
): HTMLElement {
  const wrapper = createFieldWrapper(label);
  const select = document.createElement("select");
  select.name = name;

  for (const optionValue of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    select.append(option);
  }

  select.value = value;
  wrapper.append(select);
  return wrapper;
}

function createCheckboxField(label: string, name: string, checked: boolean): HTMLElement {
  const wrapper = createFieldWrapper(label);
  const input = document.createElement("input");
  input.name = name;
  input.type = "checkbox";
  input.checked = checked;
  wrapper.append(input);
  return wrapper;
}

function createInlineCheckbox(label: string, name: string, checked: boolean): HTMLElement {
  const wrapper = createCheckboxField(label, name, checked);
  wrapper.classList.add("profile-inline-field");
  return wrapper;
}

function createReadonlyLine(label: string, value: string): HTMLElement {
  const wrapper = createFieldWrapper(label);
  const text = document.createElement("code");
  text.textContent = value;
  wrapper.append(text);
  return wrapper;
}

function createFieldWrapper(label: string): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "profile-field";
  wrapper.append(createFieldLabel(label));
  return wrapper;
}

function createFieldLabel(label: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = label;
  return span;
}

function createButton(
  label: string,
  onClick: () => void,
  extraClass = "button-secondary",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `button ${extraClass}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function getInputValue(name: string): string {
  return getScopedInputValue(root, name);
}

function getSelectValue(name: string): string {
  return getScopedSelectValue(root, name);
}

function getCheckboxValue(name: string): boolean {
  return getScopedCheckboxValue(root, name);
}

function getScopedInputValue(parent: ParentNode, name: string): string {
  const field = parent.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[name="${CSS.escape(name)}"]`,
  );
  return field?.value ?? "";
}

function getScopedSelectValue(parent: ParentNode, name: string): string {
  const field = parent.querySelector<HTMLSelectElement>(`select[name="${CSS.escape(name)}"]`);
  return field?.value ?? "";
}

function getScopedCheckboxValue(parent: ParentNode, name: string): boolean {
  const field = parent.querySelector<HTMLInputElement>(
    `input[type="checkbox"][name="${CSS.escape(name)}"]`,
  );
  return field?.checked ?? false;
}

function queryAll<T extends Element>(selector: string, parent: ParentNode = root): T[] {
  return [...parent.querySelectorAll<T>(selector)];
}

function postMessage(message: ToProfileEditorMessage): void {
  vscode.postMessage(message);
}

function cloneProfile(profile: ProfileConfig): ProfileConfig {
  return JSON.parse(JSON.stringify(profile)) as ProfileConfig;
}

function requireSelectedProfile(): ProfileConfig {
  if (selectedProfile === undefined) {
    throw new Error("No profile is selected.");
  }

  return selectedProfile;
}

function requireElement<T extends Element = HTMLElement>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}
