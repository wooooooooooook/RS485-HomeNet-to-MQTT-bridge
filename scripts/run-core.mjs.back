import process from 'node:process';
import fs from 'node:fs';
import yaml from 'js-yaml';

const parseBaudRate = (value) => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`유효하지 않은 BAUD_RATE 값: ${value ?? 'undefined'}`);
  }

  return parsed;
};

const getRequiredEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} 환경 변수를 설정해야 합니다.`);
  }

  return value;
};

async function main() {
  const { createBridge } = await import('../packages/core/dist/index.js');
  // serialPath and baudRate are now read from the config file by the bridge itself
  // const serialPath = getRequiredEnv('SERIAL_PORT');
  // const baudRate = parseBaudRate(process.env.BAUD_RATE ?? '9600');
  const mqttUrl = process.env.MQTT_URL ?? 'mqtt://mqtt:1883';
  const configFilePath = getRequiredEnv('CONFIG_FILE');

  // Load and parse the YAML configuration file
  const configFileContent = fs.readFileSync(configFilePath, 'utf8');
  const config = yaml.load(configFileContent); // Removed 'as any'

  if (!config || !config.homenet_bridge) { // Check for homenet_bridge top-level key
    throw new Error(`유효하지 않은 설정 파일: ${configFilePath}. 'homenet_bridge' 속성이 필요합니다.`);
  }

  console.log(
    `[core] 브리지를 시작합니다. mqttUrl=${mqttUrl}, configFile=${configFilePath}`
  );

  // New createBridge signature: createBridge(configPath: string, mqttUrl: string)
  const bridge = await createBridge(configFilePath, mqttUrl); // Await createBridge as it's now async and starts internally
  // await bridge.start(); // createBridge now starts the bridge internally
  console.log('[core] 시리얼 포트가 준비되어 브리지를 시작했습니다.');

  const shutdown = (signal) => {
    console.log(`[core] ${signal}를 수신했습니다. 프로세스를 종료합니다.`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[core] 브리지 실행 중 오류가 발생했습니다:', err);
  process.exit(1);
});