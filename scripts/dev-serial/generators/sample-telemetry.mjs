export async function* generate(context) {
  const intervalMs = numberOption(context.options.intervalMs, 100);
  const phase = numberOption(context.options.phase, 0);
  const temperatureBase = numberOption(context.options.temperatureBase, 24);
  const rpmBase = numberOption(context.options.rpmBase, 1200);
  const startedAt = Date.now();

  while (!context.signal.aborted) {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const t = elapsedSeconds + phase;

    const temp = temperatureBase + Math.sin(t * 1.2) * 2;
    const humidity = 50 + Math.cos(t * 1.6) * 10;
    const rpm = rpmBase + Math.sin(t * 2.4) * 300;

    yield `temp=${temp.toFixed(2)} humidity=${humidity.toFixed(2)} rpm=${rpm.toFixed(2)}\n`;
    // oxlint-disable-next-line no-await-in-loop -- The generator intentionally sleeps between samples.
    await context.sleep(intervalMs);
  }
}

export function onWrite(data, context) {
  const text = data.toString().trim();

  if (text.length > 0) {
    context.log(`received: ${text}`);
  }
}

function numberOption(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
