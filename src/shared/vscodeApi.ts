/**
 * Minimal view of the API returned by VS Code's `acquireVsCodeApi`, narrowed to
 * the persisted `State` shape and the outbound `Message` union of one webview.
 */
export interface VsCodeApi<State, Message> {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: Message): void;
}
