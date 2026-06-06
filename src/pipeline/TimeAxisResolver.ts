import type { ParsedRecord, TimeAxisConfig } from "../shared/protocol";
import { getNumberField } from "./fieldPath";

export class TimeAxisResolver {
  private firstValue: number | undefined;
  private fixedIntervalIndex = 0;

  constructor(private readonly config: TimeAxisConfig) {}

  next(record: ParsedRecord): number | null {
    if (this.config.source === "fixedInterval") {
      const time = (this.fixedIntervalIndex * this.config.intervalMs) / 1000;
      this.fixedIntervalIndex += 1;
      return time;
    }

    if (this.config.source === "sequence") {
      return record.seq;
    }

    const rawValue = this.getRawTimeValue(record);

    if (rawValue === null) {
      return null;
    }

    const zeroedValue = this.applyZero(rawValue);
    return this.convertUnit(zeroedValue);
  }

  reset(): void {
    this.firstValue = undefined;
    this.fixedIntervalIndex = 0;
  }

  private getRawTimeValue(record: ParsedRecord): number | null {
    if (this.config.source === "hostReceived") {
      return record.receivedAt;
    }

    if (this.config.source !== "field") {
      return null;
    }

    return getNumberField(record.fields, this.config.field);
  }

  private applyZero(value: number): number {
    if (this.config.source === "sequence" || this.config.source === "fixedInterval") {
      return value;
    }

    if (this.config.zero !== "first") {
      return value;
    }

    this.firstValue ??= value;
    return value - this.firstValue;
  }

  private convertUnit(value: number): number {
    if (this.config.source === "hostReceived") {
      return this.config.unit === "ms" ? value : value / 1000;
    }

    if (this.config.source !== "field") {
      return value;
    }

    if (this.config.unit === "ms") {
      return value / 1000;
    }

    if (this.config.unit === "us") {
      return value / 1_000_000;
    }

    return value;
  }
}
