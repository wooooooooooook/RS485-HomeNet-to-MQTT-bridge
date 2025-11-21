import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadYamlConfig } from '../packages/core/dist/config/yaml-loader.js';

const DEFAULT_LINK_PATH = '/simshare/rs485-sim-tty';

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

const exposePty = async (ptyPath, linkPath) => {
  await mkdir(path.dirname(linkPath), { recursive: true });
  await rm(linkPath, { force: true });
  await symlink(ptyPath, linkPath);
  await writeFile(`${linkPath}.meta`, JSON.stringify({ ptyPath }, null, 2));
};

async function main() {
  const { createSimulator, COMMAX_TEST_PACKETS } = await import(
    '../packages/simulator/dist/index.js'
  );
  const intervalMs = ensureNumber(process.env.SIMULATOR_INTERVAL_MS, 1000);
  const linkPath = process.env.SIMULATOR_LINK_PATH ?? DEFAULT_LINK_PATH;

  const configPath =
    process.env.CONFIG_PATH ?? 'packages/core/config/commax.homenet_bridge.yaml';
  const config = await loadYamlConfig(configPath);
  const checksumType = config.homenet_bridge.packet_defaults.tx_checksum;

  const simulatorProtocol = process.env.SIMULATOR_PROTOCOL || 'pty';

  let simulator;
  if (simulatorProtocol === 'tcp') {
    const { createTcpSimulator } = await import('../packages/simulator/dist/index.js');
    simulator = createTcpSimulator({
      intervalMs,
      packets: COMMAX_TEST_PACKETS,
      checksumType,
      port: 8888
    });
    console.log(`[simulator] TCP Mode started on port 8888`);
  } else {
    simulator = createSimulator({
      intervalMs,
      packets: COMMAX_TEST_PACKETS,
      checksumType,
    });
    await exposePty(simulator.ptyPath, linkPath);
    console.log(
      `[simulator] PTY 노출: 실제=${simulator.ptyPath}, 링크=${linkPath} (interval=${intervalMs}ms)`
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
