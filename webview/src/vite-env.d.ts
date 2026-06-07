declare module "*.css";

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module "*.html?raw" {
  const source: string;
  export default source;
}
