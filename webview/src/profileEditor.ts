import "./profileEditor.css";
import {
  parserModes,
  type LineEnding,
  type ParserMode,
  type ProfileConfig,
  type ProfileEditorState,
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

interface PersistedState {
  selectedProfileId: string;
}

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

const vscode = acquireVsCodeApi<PersistedState>();
const root = requireElement(document, "#profileApp");
let editorState: ProfileEditorState | undefined;
let selectedProfile: ProfileConfig | undefined;
let selectedSource: ProfileSourceMetadata | undefined;
let statusText = "";

renderLoading();
postMessage({
  type: "requestProfileEditorState",
  profileId: vscode.getState()?.selectedProfileId,
});

window.addEventListener("message", (event: MessageEvent<ToProfileEditorWebviewMessage>) => {
  const message = event.data;

  if (message.type === "profileEditorState") {
    editorState = message.state;
    selectedProfile = cloneProfile(message.state.selectedProfile);
    selectedSource = message.state.selectedSource;
    vscode.setState({ selectedProfileId: message.state.selectedProfile.id });
    statusText = message.state.errors.join("\n");
    renderEditor();
    return;
  }

  if (message.type === "requestSaveProfile") {
    saveCurrentProfile();
    return;
  }

  if (message.type === "profileSaved") {
    statusText = `Saved ${message.profileId} to ${message.filePath}`;
    renderEditor();
    return;
  }

  statusText = message.message;
  renderEditor();
});

function renderLoading(): void {
  root.innerHTML = "";
  const container = document.createElement("main");
  container.className = "profile-editor";
  container.textContent = "Loading profiles...";
  root.append(container);
}

function renderEditor(): void {
  if (editorState === undefined || selectedProfile === undefined) {
    renderLoading();
    return;
  }

  root.innerHTML = "";

  const container = document.createElement("main");
  container.className = "profile-editor";
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
    const status = document.createElement("pre");
    status.className = "profile-status";
    status.textContent = statusText;
    container.append(status);
  }

  root.append(container);
}

function renderToolbar(): HTMLElement {
  const toolbar = document.createElement("header");
  toolbar.className = "profile-editor-toolbar";

  const profileSelect = document.createElement("select");
  profileSelect.id = "profileId";

  for (const profile of editorState?.profiles ?? []) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.scope})`;
    profileSelect.append(option);
  }

  profileSelect.value = selectedProfile?.id ?? "";
  profileSelect.addEventListener("change", () => {
    vscode.setState({ selectedProfileId: profileSelect.value });
    postMessage({ type: "selectProfileForEdit", profileId: profileSelect.value });
  });

  toolbar.append(
    profileSelect,
    createButton("Refresh", () => postMessage({ type: "requestProfileEditorState" })),
    createButton("Save Profile", () => saveCurrentProfile(), "button-primary"),
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

function saveCurrentProfile(): void {
  if (selectedProfile === undefined) {
    return;
  }

  try {
    postMessage({
      type: "saveProfile",
      profile: applyProfileEditorPatch(selectedProfile, collectPatch()),
    });
  } catch (error) {
    statusText = error instanceof Error ? error.message : String(error);
    renderEditor();
  }
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
