export function parseJsonc(text: string): unknown {
  return JSON.parse(removeTrailingCommas(stripJsonComments(text))) as unknown;
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);

    if (inString) {
      output += char;

      if (char === '"' && !escaped) {
        inString = false;
      }

      escaped = !escaped && char === "\\";

      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;

      while (index < text.length && text.charAt(index) !== "\n") {
        index += 1;
      }

      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;

      while (
        index < text.length &&
        !(text.charAt(index) === "*" && text.charAt(index + 1) === "/")
      ) {
        index += 1;
      }

      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function removeTrailingCommas(text: string): string {
  return text.replaceAll(/,\s*([}\]])/g, "$1");
}
