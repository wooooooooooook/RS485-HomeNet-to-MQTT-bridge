import { spawnSync } from 'node:child_process';
import { setInterval as createInterval, clearInterval } from 'node:timers';
import { pathToFileURL } from 'node:url';
import type { IPty } from 'node-pty-prebuilt-multiarch';
import * as pty from 'node-pty-prebuilt-multiarch';

const DEFAULT_INTERVAL_MS = 1000;

export const DEFAULT_PACKETS: readonly Buffer[] = [
  Buffer.from([0xaa, 0x55, 0x10, 0x02, 0x01, 0x00, 0xff]),
  Buffer.from([0xaa, 0x55, 0x11, 0x03, 0x02, 0x33, 0xcc, 0xff])
];

type PtyWithWrite = IPty & {
  readonly pty?: string;
  readonly ptsName?: string;
  write(data: string | Buffer): void;
  destroy(): void;
};

type PtyModule = typeof pty & {
  open: (options: { cols?: number; rows?: number; encoding?: string | null }) => PtyWithWrite;
};

export interface SimulatorOptions {
  /** 패킷 사이 간격 (밀리초). */
  intervalMs?: number;
  /** 주입할 RS485 패킷 목록. */
  packets?: readonly (Buffer | Uint8Array | number[])[];
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

function normalizePackets(packets: readonly (Buffer | Uint8Array | number[])[]): Buffer[] {
  if (packets.length === 0) {
    throw new Error('패킷 목록이 비어 있습니다. 최소 한 개 이상의 패킷이 필요합니다.');
  }

  return packets.map((packet) => {
    if (Buffer.isBuffer(packet)) {
      return Buffer.from(packet);
    }

    if (packet instanceof Uint8Array) {
      return Buffer.from(packet);
    }

    return Buffer.from(packet);
  });
}

export function createSimulator(options: SimulatorOptions = {}): Simulator {
  const { intervalMs = DEFAULT_INTERVAL_MS, packets = DEFAULT_PACKETS } = options;
  const normalizedPackets = normalizePackets(packets);
  const { open: openPty } = pty as PtyModule;
  const terminal = openPty({ cols: 80, rows: 24, encoding: null });
  const writer = terminal as unknown as { write(data: string | Buffer): void };
  const ptyPath =
    terminal.pty ??
    terminal.ptsName ??
    (terminal as { _pty?: string })._pty;

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

  const sendNextPacket = () => {
    const packet = normalizedPackets[packetIndex];
    packetIndex = (packetIndex + 1) % normalizedPackets.length;
    writer.write(packet);
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
    dispose
  };
}

function main() {
  const simulator = createSimulator();
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
