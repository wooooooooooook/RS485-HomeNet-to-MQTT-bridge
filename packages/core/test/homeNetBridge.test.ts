import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

class FakeSerialPort extends EventEmitter {
  public options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    serialPortInstances.push(this);
  }
}

const serialPortInstances: FakeSerialPort[] = [];
const publishMock = vi.fn();
const mqttConnectMock = vi.fn(() => ({
  publish: publishMock,
}));

vi.mock('serialport', () => ({
  SerialPort: FakeSerialPort,
}));

vi.mock('mqtt', () => ({
  default: {
    connect: mqttConnectMock,
  },
}));

vi.mock('dotenv', () => ({
  default: {
    config: vi.fn(),
  },
  config: vi.fn(),
}));

describe('HomeNetBridge', () => {
  beforeEach(() => {
    serialPortInstances.length = 0;
    publishMock.mockClear();
    mqttConnectMock.mockClear();
    vi.resetModules();
  });

  it('publishes serial data to MQTT when started', async () => {
    const { createBridge } = await import('../src/index.ts');

    const bridge = createBridge({
      serialPath: '/dev/ttyUSB0',
      baudRate: 115200,
      mqttUrl: 'mqtt://localhost',
    });

    bridge.start();

    expect(mqttConnectMock).toHaveBeenCalledWith('mqtt://localhost');
    expect(serialPortInstances).toHaveLength(1);

    const port = serialPortInstances[0];
    port.emit('data', Buffer.from('payload'));

    expect(publishMock).toHaveBeenCalledWith('homenet/raw', 'payload');
  });

  it('passes serial configuration options to SerialPort', async () => {
    const { createBridge } = await import('../src/index.ts');

    const options = {
      serialPath: '/dev/ttyS1',
      baudRate: 57600,
      mqttUrl: 'mqtt://example',
    };

    createBridge(options);

    expect(serialPortInstances).toHaveLength(1);
    expect(serialPortInstances[0].options).toMatchObject({
      path: options.serialPath,
      baudRate: options.baudRate,
    });
  });
});
