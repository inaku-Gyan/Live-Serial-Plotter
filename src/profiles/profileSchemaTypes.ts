import type { ProfileConfig } from "../shared/protocol";

/**
 * Profile JSONC file shape. Runtime messages keep using `ProfileConfig`; this
 * type exists only as the JSON Schema generation entrypoint.
 */
export interface ProfileConfigFile extends ProfileConfig {
  /**
   * VS Code JSON Schema association for Live Serial Plotter profiles.
   */
  $schema?: "vscode://schemas/live-serial-plotter/profile";
}
