import { createApp } from "vue";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import MonitorApp from "./monitor/MonitorApp.vue";
import {
  createMonitorStore,
  MonitorStoreKey,
  type MonitorPersistedState,
  type MonitorStoreOptions,
  type VsCodeApi,
} from "./monitor/store";

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

const root = document.querySelector<HTMLElement>("#app");

if (root === null) {
  throw new Error("Missing required element: #app");
}

const vscode = acquireVsCodeApi<MonitorPersistedState>();
const initialProfileKey = nonEmptyString(document.body.dataset.initialProfileKey);
const storeOptions: MonitorStoreOptions = {};

if (initialProfileKey !== undefined) {
  storeOptions.initialProfileKey = initialProfileKey;
}

const store = createMonitorStore(vscode, storeOptions);
const app = createApp(MonitorApp);
app.provide(MonitorStoreKey, store);
app.mount(root);

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
