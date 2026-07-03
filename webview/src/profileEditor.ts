import { createApp } from "vue";
import "@vscode/codicons/dist/codicon.css";
import "./profileEditor.css";
import ProfileEditorApp from "./profile-editor/ProfileEditorApp.vue";
import {
  createProfileEditorStore,
  ProfileEditorStoreKey,
  type ProfileEditorPersistedState,
  type VsCodeApi,
} from "./profile-editor/store";

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

const root = document.querySelector<HTMLElement>("#profileApp");

if (root === null) {
  throw new Error("Missing required element: #profileApp");
}

const vscode = acquireVsCodeApi<ProfileEditorPersistedState>();
const store = createProfileEditorStore(vscode);
const app = createApp(ProfileEditorApp);
app.provide(ProfileEditorStoreKey, store);
app.mount(root);
