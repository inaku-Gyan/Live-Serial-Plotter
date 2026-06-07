import { createApp } from "vue";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import MonitorApp from "./monitor/MonitorApp.vue";
import { createMonitorStore, type MonitorPersistedState, type VsCodeApi } from "./monitor/store";

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

const root = document.querySelector<HTMLElement>("#app");

if (root === null) {
  throw new Error("Missing required element: #app");
}

const vscode = acquireVsCodeApi<MonitorPersistedState>();
const initialProfileKey = nonEmptyString(document.body.dataset.initialProfileKey);
const store = createMonitorStore(vscode, { initialProfileKey });

createApp(MonitorApp, { store }).mount(root);

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
