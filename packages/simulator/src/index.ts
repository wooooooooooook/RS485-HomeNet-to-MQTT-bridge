import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setInterval as createInterval, clearInterval } from 'node:timers';
import { pathToFileURL } from 'node:url';
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';

import { SAMSUNG_SDS_PACKETS } from './samsung_sds.js';
import { COMMAX_PACKETS } from './commax.js';
import { CVNET_PACKETS } from './cvnet.js';
import { EZVILLE_PACKETS } from './ezville.js';
import { HYUNDAI_IMAZU_PACKETS } from './hyundai_imazu.js';
import { KOCOM_PACKETS } from './kocom.js';

const DEFAULT_INTERVAL_MS = 1000;

export const DEFAULT_PACKETS: readonly Buffer[] = [
  Buffer.from([0xaa, 0x55, 0x10, 0x02, 0x01, 0x00, 0xff]),
  Buffer.from([0xaa, 0x55, 0x11, 0x03, 0x02, 0x33, 0xcc, 0xff]),
];

// Packets for commax.new.yaml

type PtyWithWrite = IPty & {
  readonly pty?: string;
  readonly ptsName?: string;
  write(data: string | Buffer): void;
  destroy(): void;
};

type PtyModule = typeof pty & {
  open: (options: { cols?: number; rows?: number; encoding?: string | null }) => PtyWithWrite;
};

export type DeviceType = 'commax' | 'samsung_sds' | 'cvnet' | 'ezville' | 'hyundai_imazu' | 'kocom';

export interface SimulatorOptions {
  /** 패킷 사이 간격 (밀리초). */
  intervalMs?: number;
  /** 주입할 RS485 패킷 목록. */
  packets?: readonly (Buffer | Uint8Array | number[])[];
  /** 시뮬레이션할 장치 유형. */
  device?: DeviceType;
}

export interface Simulator {
  /** 슬레이브 PTY 경로. */
  readonly ptyPath: string;
  /** 패킷 주입을 시작한다. */
  start(): void;
  /** 패킷 주입을 중단한다. */
  stop(): void;
  /** PTY를 정리하고 닫는다. */
  dispose(): void;
  /** 현재 주입 여부. */
  readonly running: boolean;
}

function getPacketsForDevice(device: DeviceType): readonly (Buffer | Uint8Array | number[])[] {
  switch (device) {
    case 'commax':
      return COMMAX_PACKETS;
    case 'samsung_sds':
      return SAMSUNG_SDS_PACKETS;
    case 'cvnet':
      return CVNET_PACKETS;
    case 'ezville':
      return EZVILLE_PACKETS;
    case 'hyundai_imazu':
      return HYUNDAI_IMAZU_PACKETS;
    case 'kocom':
      return KOCOM_PACKETS;
    default:
      return DEFAULT_PACKETS;
  }
}

function normalizePackets(packets: readonly (Buffer | Uint8Array | number[])[]): Buffer[] {
  if (packets.length === 0) {
    throw new Error('패킷 목록이 비어 있습니다. 최소 한 개 이상의 패킷이 필요합니다.');
  }

  return packets.map((packet) => {
    const buffer = Buffer.isBuffer(packet)
      ? packet
      : Buffer.from(packet instanceof Uint8Array ? packet : (packet as number[]));
    return buffer;
  });
}

export interface TcpSimulator extends Simulator {
  readonly port: number;
}

export function createTcpSimulator(
  options: SimulatorOptions & { port?: number } = {},
): TcpSimulator {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    packets: userPackets,
    port = 8888,
    device = 'commax',
  } = options;
  const packets = userPackets ?? getPacketsForDevice(device);
  const normalizedPackets = normalizePackets(packets);

  const clients = new Set<any>();

  const server = createServer((socket: any) => {
    console.log(`[simulator] Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
    clients.add(socket);

    socket.on('close', () => {
      console.log(`[simulator] Client disconnected: ${socket.remoteAddress}:${socket.remotePort}`);
      clients.delete(socket);
    });

    socket.on('error', (err: Error) => {
      console.error(`[simulator] Client error: ${err.message}`);
      clients.delete(socket);
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[simulator] TCP Server listening on 0.0.0.0:${port}`);
  });

  let timer: NodeJS.Timeout | undefined;
  let packetIndex = 0;

  const logPacket = (packet: Buffer) => {
    const hex = Array.from(packet)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ');
    console.log(`[simulator] TX (${packet.length} bytes): ${hex}`);
  };

  const sendNextPacket = () => {
    const packet = normalizedPackets[packetIndex];
    packetIndex = (packetIndex + 1) % normalizedPackets.length;

    if (clients.size > 0) {
      logPacket(packet);
      for (const client of clients) {
        client.write(packet);
      }
    }
  };

  const start = () => {
    if (timer) return;
    sendNextPacket();
    timer = createInterval(sendNextPacket, intervalMs);
  };

  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };

  const dispose = () => {
    stop();
    for (const client of clients) {
      client.destroy();
    }
    clients.clear();
    server.close();
  };

  return {
    get running() {
      return Boolean(timer);
    },
    ptyPath: `tcp://0.0.0.0:${port}`, // Pseudo path for compatibility
    port,
    start,
    stop,
    dispose,
  };
}

export function createSimulator(options: SimulatorOptions = {}): Simulator {
  const { intervalMs = DEFAULT_INTERVAL_MS, packets: userPackets, device = 'commax' } = options;
  const packets = userPackets ?? getPacketsForDevice(device);
  const normalizedPackets = normalizePackets(packets);
  const { open: openPty } = pty as PtyModule;
  const terminal = openPty({ cols: 80, rows: 24, encoding: null });
  const writer = terminal as unknown as { write(data: string | Buffer): void };
  const ptyPath = terminal.pty ?? terminal.ptsName ?? (terminal as { _pty?: string })._pty;

  if (!ptyPath) {
    terminal.destroy();
    throw new Error('생성된 PTY 경로를 확인할 수 없습니다.');
  }

  const sttyResult = spawnSync('stty', ['-F', ptyPath, 'raw', '-echo']);
  if (sttyResult.status !== 0) {
    const stderr = sttyResult.stderr?.toString().trim();
    const message = stderr ? `: ${stderr}` : '';
    console.warn(`슬레이브 PTY를 RAW 모드로 전환하지 못했습니다${message}`);
  }

  let timer: NodeJS.Timeout | undefined;
  let packetIndex = 0;

  const logPacket = (packet: Buffer) => {
    const hex = Array.from(packet)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ');
    console.log(`[simulator] TX (${packet.length} bytes): ${hex}`);
  };

  const sendNextPacket = () => {
    const packet = normalizedPackets[packetIndex];
    packetIndex = (packetIndex + 1) % normalizedPackets.length;
    writer.write(packet);
    logPacket(packet);
  };

  const start = () => {
    if (timer) {
      return;
    }

    sendNextPacket();
    timer = createInterval(sendNextPacket, intervalMs);
  };

  const stop = () => {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = undefined;
  };

  const dispose = () => {
    stop();
    terminal.destroy();
  };

  return {
    get running() {
      return Boolean(timer);
    },
    ptyPath,
    start,
    stop,
    dispose,
  };
}

async function main() {
  const device = (process.env.SIMULATOR_DEVICE as DeviceType) || 'commax';
  const protocol = process.env.SIMULATOR_PROTOCOL || 'pty';

  let simulator: Simulator;

  if (protocol === 'tcp') {
    const port = process.env.SIMULATOR_PORT ? parseInt(process.env.SIMULATOR_PORT, 10) : 8888;
    simulator = createTcpSimulator({
      port,
      device,
    });
  } else {
    simulator = createSimulator({
      device,
    });
  }

  console.log(JSON.stringify({ ptyPath: simulator.ptyPath }));
  simulator.start();

  const handleExit = () => {
    simulator.dispose();
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}

const isDirectExecution = (() => {
  if (process.argv[1] === undefined) {
    return false;
  }

  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main();
}
