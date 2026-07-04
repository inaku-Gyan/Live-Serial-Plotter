import { createApp } from "vue";
import "@vscode/codicons/dist/codicon.css";
import "./profileEditor.css";
import ProfileEditorApp from "./profile-editor/ProfileEditorApp.vue";
import {
  createProfileEditorStore,
  ProfileEditorStoreKey,
  type ProfileEditorVsCodeApi,
} from "./profile-editor/store";

declare function acquireVsCodeApi(): ProfileEditorVsCodeApi;

const root = document.querySelector<HTMLElement>("#profileApp");

if (root === null) {
  throw new Error("Missing required element: #profileApp");
}

const vscode = acquireVsCodeApi();
const store = createProfileEditorStore(vscode);
const app = createApp(ProfileEditorApp);
app.provide(ProfileEditorStoreKey, store);
app.mount(root);
