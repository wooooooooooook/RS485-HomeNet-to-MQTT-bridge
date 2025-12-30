import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { SerialPort } from 'serialport';

import { SAMSUNG_SDS_PACKETS } from './samsung_sds.js';
import { SAMSUNG_SDS_CAPTURED_PACKETS } from './samsung_sds_captured.js';
import { PACKETS_FROM_USERDATA } from './packets_from_userdata.js';
import { COMMAX_PACKETS } from './commax.js';
import { CVNET_PACKETS } from './cvnet.js';
import { EZVILLE_PACKETS } from './ezville.js';
import { HYUNDAI_IMAZU_PACKETS } from './hyundai_imazu.js';
import { KOCOM_PACKETS } from './kocom.js';

export const DEFAULT_PACKETS: readonly Buffer[] = [
  Buffer.from([0xaa, 0x55, 0x10, 0x02, 0x01, 0x00, 0xff]),
  Buffer.from([0xaa, 0x55, 0x11, 0x03, 0x02, 0x33, 0xcc, 0xff]),
];

type PtyModule = typeof pty & {
  open: (options: { cols?: number; rows?: number; encoding?: string | null }) => any;
};

export type DeviceType =
  | 'commax'
  | 'samsung_sds'
  | 'samsung_sds_captured'
  | 'cvnet'
  | 'ezville'
  | 'hyundai_imazu'
  | 'kocom'
  | 'userdata';

export interface SimulatorOptions {
  intervalMs?: number;
  packets?: readonly (Buffer | Uint8Array | number[])[];
  device?: DeviceType;
  baudRate?: number;
  parity?: 'none' | 'even' | 'mark' | 'space' | 'odd';
  slow?: number;
}

export interface Simulator {
  readonly ptyPath: string;
  start(): void;
  stop(): void;
  dispose(): void;
  readonly running: boolean;
}

function getPacketsForDevice(device: DeviceType): readonly (Buffer | Uint8Array | number[])[] {
  switch (device) {
    case 'commax':
      return COMMAX_PACKETS;
    case 'samsung_sds':
      return SAMSUNG_SDS_PACKETS;
    case 'samsung_sds_captured':
      return SAMSUNG_SDS_CAPTURED_PACKETS;
    case 'cvnet':
      return CVNET_PACKETS;
    case 'ezville':
      return EZVILLE_PACKETS;
    case 'hyundai_imazu':
      return HYUNDAI_IMAZU_PACKETS;
    case 'kocom':
      return KOCOM_PACKETS;
    case 'userdata':
      return PACKETS_FROM_USERDATA;
    default:
      return PACKETS_FROM_USERDATA.length > 0 ? PACKETS_FROM_USERDATA : DEFAULT_PACKETS;
  }
}

function normalizePackets(packets: readonly (Buffer | Uint8Array | number[])[]): Buffer[] {
  if (packets.length === 0) throw new Error('패킷 목록이 비어 있습니다.');
  return packets.map((packet) =>
    Buffer.isBuffer(packet)
      ? packet
      : Buffer.from(packet instanceof Uint8Array ? packet : (packet as number[])),
  );
}

class PacketStreamer {
  private _isRunning = false;
  private byteIndex = 0;
  private nextSendTime = 0n;
  private nsPerByte: bigint;
  private allBytes: Buffer;

  constructor(
    packets: Buffer[],
    baudRate: number,
    slow: number,
    private writer: (data: Buffer) => void,
  ) {
    this.allBytes = Buffer.concat(packets);
    const slowFactor = Math.max(1, slow);
    this.nsPerByte = BigInt(Math.floor((1_000_000_000 / (baudRate / 11)) * slowFactor));
  }

  get running() {
    return this._isRunning;
  }

  start() {
    if (!this._isRunning) {
      this._isRunning = true;
      this.nextSendTime = 0n;
      this.loop();
    }
  }

  stop() {
    this._isRunning = false;
  }

  private loop = () => {
    if (!this._isRunning) return;
    const now = process.hrtime.bigint();
    if (this.nextSendTime === 0n) this.nextSendTime = now;

    if (now >= this.nextSendTime) {
      const timeDiff = now - this.nextSendTime;
      const count = Number(timeDiff / this.nsPerByte + 1n);
      const safeCount = Math.min(count, 1024);

      if (safeCount > 0) {
        const remaining = this.allBytes.length - this.byteIndex;
        if (safeCount <= remaining) {
          this.writer(this.allBytes.subarray(this.byteIndex, this.byteIndex + safeCount));
          this.byteIndex = (this.byteIndex + safeCount) % this.allBytes.length;
        } else {
          this.writer(this.allBytes.subarray(this.byteIndex));
          const secondPartLen = safeCount - remaining;
          this.writer(this.allBytes.subarray(0, secondPartLen));
          this.byteIndex = secondPartLen;
        }
        this.nextSendTime += BigInt(safeCount) * this.nsPerByte;
      }
    }
    // Optimization: Use setTimeout instead of setImmediate to batch writes (~10ms intervals).
    // Sending data byte-by-byte (1000Hz) overloads the receiver's event loop.
    // Batching maintains throughput (9600 baud) but reduces CPU interrupts.
    setTimeout(this.loop, 10);
  };
}

export interface TcpSimulator extends Simulator {
  readonly port: number;
}

export function createTcpSimulator(
  options: SimulatorOptions & { port?: number } = {},
): TcpSimulator {
  const {
    baudRate = 9600,
    packets: userPackets,
    port = 8888,
    device = 'commax',
    slow = 1,
  } = options;
  const packets = userPackets ?? getPacketsForDevice(device);
  const normalizedPackets = normalizePackets(packets);
  const clients = new Set<any>();

  const server = createServer((socket: any) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  server.listen(port, '0.0.0.0');

  const streamer = new PacketStreamer(normalizedPackets, baudRate, slow, (data) => {
    for (const client of clients) {
      try {
        client.write(data);
      } catch (e) { }
    }
  });

  return {
    get running() {
      return streamer.running;
    },
    ptyPath: `tcp://0.0.0.0:${port}`,
    port,
    start: () => streamer.start(),
    stop: () => streamer.stop(),
    dispose: () => {
      streamer.stop();
      for (const client of clients) client.destroy();
      server.close();
    },
  };
}

export function createSimulator(options: SimulatorOptions = {}): Simulator {
  const { baudRate = 9600, packets: userPackets, device = 'commax', slow = 1 } = options;
  const packets = userPackets ?? getPacketsForDevice(device);
  const normalizedPackets = normalizePackets(packets);
  const { open: openPty } = pty as PtyModule;
  const terminal = openPty({ cols: 80, rows: 24, encoding: null });
  const writer = terminal as unknown as { write(data: string | Buffer): void };
  const ptyPath = terminal.pty ?? terminal.ptsName ?? (terminal as any)._pty;

  if (spawnSync('stty', ['-F', ptyPath, 'raw', '-echo']).status !== 0)
    console.warn('RAW 모드 전환 실패');

  const streamer = new PacketStreamer(normalizedPackets, baudRate, slow, (data) =>
    writer.write(data),
  );

  return {
    get running() {
      return streamer.running;
    },
    ptyPath,
    start: () => streamer.start(),
    stop: () => streamer.stop(),
    dispose: () => {
      streamer.stop();
      terminal.destroy();
    },
  };
}

export function createExternalPortSimulator(
  options: SimulatorOptions & { portPath: string },
): Simulator {
  const {
    baudRate = 9600,
    packets: userPackets,
    device = 'commax',
    portPath,
    parity = 'none',
    slow = 1,
  } = options;
  const packets = userPackets ?? getPacketsForDevice(device);
  const normalizedPackets = normalizePackets(packets);

  const port = new SerialPort({
    path: portPath,
    baudRate,
    parity,
    autoOpen: false,
  });

  port.open((err) => {
    if (err) console.error(`[ExternalPortSimulator] Failed to open ${portPath}:`, err);
  });

  const streamer = new PacketStreamer(normalizedPackets, baudRate, slow, (data) => {
    if (port.isOpen) {
      port.write(data);
    }
  });

  return {
    get running() {
      return streamer.running;
    },
    ptyPath: portPath,
    start: () => streamer.start(),
    stop: () => streamer.stop(),
    dispose: () => {
      streamer.stop();
      if (port.isOpen) port.close();
    },
  };
}

// Main execution logic used when running this file directly (e.g. via node)
async function main() {
  const device = (process.env.SIMULATOR_DEVICE as DeviceType) || 'commax';
  const protocol = process.env.SIMULATOR_PROTOCOL || 'pty';
  const portPath = process.env.SIMULATOR_PORT_PATH;
  const slow = process.env.SIMULATOR_SLOW ? parseFloat(process.env.SIMULATOR_SLOW) : 1;

  let simulator: Simulator;

  if (protocol === 'serial' && portPath) {
    simulator = createExternalPortSimulator({ device, baudRate: 9600, portPath, slow });
  } else if (protocol === 'tcp') {
    simulator = createTcpSimulator({ device, baudRate: 9600, slow });
  } else {
    // PTY mode
    simulator = createSimulator({ device, baudRate: 9600, slow });
  }

  console.log(JSON.stringify({ ptyPath: simulator.ptyPath, slow }));
  simulator.start();
  const handleExit = () => {
    simulator.dispose();
    process.exit(0);
  };
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectExecution) main();
