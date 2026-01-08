import process from 'node:process';

const ensureNumber = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`유효하지 않은 숫자 값: ${value}`);
  }

  return parsed;
};

async function main() {
  const { createSimulator, COMMAX_TEST_PACKETS } = await import(
    '../packages/simulator/dist/index.js'
  );
  const intervalMs = ensureNumber(process.env.SIMULATOR_INTERVAL_MS, 1000);
  const slow = ensureNumber(process.env.SIMULATOR_SLOW, 1);

  const simulatorProtocol = process.env.SIMULATOR_PROTOCOL || 'pty';
  const device = process.env.SIMULATOR_DEVICE || 'commax';

  let simulator;
  if (simulatorProtocol === 'tcp') {
    const { createTcpSimulator } = await import('../packages/simulator/dist/index.js');
    simulator = createTcpSimulator({
      intervalMs,
      packets: device === 'commax' ? COMMAX_TEST_PACKETS : undefined,
      device,
      device,
      baudRate: 9600,
      port: 8888,
      slow
    });
    console.log(`[simulator] TCP Mode started on port 8888 (device=${device}, baudRate=9600, slow=${slow})`);
  } else if (simulatorProtocol === 'serial') {
    const { createExternalPortSimulator } = await import('../packages/simulator/dist/index.js');
    const portPath = process.env.SIMULATOR_PORT_PATH;
    if (!portPath) {
      throw new Error('SIMULATOR_PORT_PATH must be defined for serial protocol');
    }

    // Determine parity based on device
    const parity = device.startsWith('samsung') ? 'even' : 'none';

    simulator = createExternalPortSimulator({
      device,
      baudRate: 9600,
      portPath,
      parity,
      slow
    });
    console.log(`[simulator] External Serial Mode started on ${portPath} (device=${device}, baudRate=9600, parity=${parity}, slow=${slow})`);
  } else {

    simulator = createSimulator({
      intervalMs: 1,
      packets: device === 'commax' ? COMMAX_TEST_PACKETS : undefined,
      device,
      slow,
    });
    console.log(
      `[simulator] PTY 노출: 실제=${simulator.ptyPath} (Byte Mode: 1ms, slow=${slow})`
    );
  }

  simulator.start();

  const shutdown = (signal) => {
    console.log(`[simulator] ${signal} 신호를 수신했습니다. 종료 절차를 진행합니다.`);
    simulator.dispose();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[simulator] 실행 중 오류가 발생했습니다:', err);
  process.exit(1);
});
