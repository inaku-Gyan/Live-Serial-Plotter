export const baudRatePresets = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] as const;

const positiveIntegerPattern = /^[1-9]\d*$/;

export function parseBaudRateInput(value: number | string): number {
  const trimmed = String(value).trim();

  if (!positiveIntegerPattern.test(trimmed)) {
    throw new Error("Baud rate must be a positive integer.");
  }

  const baudRate = Number(trimmed);

  if (!Number.isSafeInteger(baudRate)) {
    throw new Error("Baud rate must be a safe positive integer.");
  }

  return baudRate;
}

export function isBaudRateInputValid(value: number | string): boolean {
  try {
    parseBaudRateInput(value);
    return true;
  } catch {
    return false;
  }
}
