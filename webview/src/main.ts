import { createApp } from "vue";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import MonitorPage from "./monitor/MonitorPage.vue";
import {
  createPageStore,
  PageStoreKey,
  type PageStoreOptions,
  type PageVsCodeApi,
} from "./monitor/store";

declare function acquireVsCodeApi(): PageVsCodeApi;

const root = document.querySelector<HTMLElement>("#app");

if (root === null) {
  throw new Error("Missing required element: #app");
}

const vscode = acquireVsCodeApi();
const initialProfileKey = nonEmptyString(document.body.dataset.initialProfileKey);
const storeOptions: PageStoreOptions = {};

if (initialProfileKey !== undefined) {
  storeOptions.initialProfileKey = initialProfileKey;
}

const store = createPageStore(vscode, storeOptions);
const app = createApp(MonitorPage);
app.provide(PageStoreKey, store);
app.mount(root);

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
