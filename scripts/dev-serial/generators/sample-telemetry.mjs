export async function* generate(context) {
  const intervalMs = numberOption(context.options.intervalMs, 100);
  const phase = numberOption(context.options.phase, 0);
  const temperatureBase = numberOption(context.options.temperatureBase, 24);
  const rpmBase = numberOption(context.options.rpmBase, 1200);

  let t = phase;

  while (!context.signal.aborted) {
    t += 0.1;

    const temp = temperatureBase + Math.sin(t) * 2;
    const humidity = 50 + Math.cos(t * 0.7) * 10;
    const rpm = Math.round(rpmBase + Math.sin(t * 0.4) * 300);

    yield `temp=${temp.toFixed(2)} humidity=${humidity.toFixed(2)} rpm=${rpm}\n`;
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
