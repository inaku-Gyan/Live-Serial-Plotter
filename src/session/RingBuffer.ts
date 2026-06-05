export class RingBuffer<T> {
  private readonly items: T[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('RingBuffer capacity must be a positive integer.');
    }
  }

  push(item: T): void {
    this.items.push(item);

    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  pushMany(items: readonly T[]): void {
    for (const item of items) {
      this.push(item);
    }
  }

  clear(): void {
    this.items.length = 0;
  }

  toArray(): T[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }
}
