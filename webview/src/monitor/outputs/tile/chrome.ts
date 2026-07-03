import type { OutputConfig } from "../../../../../src/shared/protocol";

export function createTileHeader(
  config: OutputConfig,
  fallbackKind: string,
  onReset?: () => void,
): HTMLElement {
  const header = document.createElement("header");
  header.className = "output-header";

  const text = document.createElement("div");
  text.className = "output-title-block";

  const title = document.createElement("strong");
  title.textContent = config.title ?? config.id;

  const meta = document.createElement("span");
  meta.textContent = `${fallbackKind} / ${config.id}`;

  text.append(title, meta);
  header.append(text);

  if (onReset !== undefined) {
    appendTileHeaderButton(header, "Reset", onReset, "output-reset-button");
  }

  return header;
}

export function appendTileHeaderButton(
  header: HTMLElement,
  label: string,
  onClick: () => void,
  className: string,
): HTMLButtonElement {
  const actions = getTileHeaderActions(header);
  const button = document.createElement("button");
  button.className = `button button-secondary ${className}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  actions.append(button);
  return button;
}

function getTileHeaderActions(header: HTMLElement): HTMLElement {
  const existingActions = header.querySelector<HTMLElement>(".output-header-actions");

  if (existingActions !== null) {
    return existingActions;
  }

  const actions = document.createElement("div");
  actions.className = "output-header-actions";
  header.append(actions);
  return actions;
}
