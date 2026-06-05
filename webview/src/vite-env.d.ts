declare module "*.css";

declare module "*.html?raw" {
  const source: string;
  export default source;
}
