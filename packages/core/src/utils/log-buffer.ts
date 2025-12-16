export interface LogEntry {
  timestamp: number;
  level: string;
  args: any[];
}

export class LogBuffer {
  private buffer: LogEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  add(level: string, args: any[]) {
    this.buffer.push({
      timestamp: Date.now(),
      level,
      args,
    });
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getLogs(): LogEntry[] {
    return [...this.buffer];
  }

  clear() {
    this.buffer = [];
  }
}

export const logBuffer = new LogBuffer(1000);
