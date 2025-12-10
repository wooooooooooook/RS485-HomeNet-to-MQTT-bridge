import { EventEmitter } from 'events';
import { StateManager } from './state/state-manager.js';
import { eventBus } from './service/event-bus.js';
import { Buffer } from 'buffer';

// Mocks
const mockConfig = {
  serial: { port: '/dev/test', baud_rate: 9600 },
  mqtt: { broker_url: 'mqtt://localhost' },
  devices: [],
} as any;

class MockPacketProcessor extends EventEmitter {
  processChunk(chunk: Buffer) {}
}

const mockMqttPublisher = {
  publish: () => {},
} as any;

const packetProcessor = new MockPacketProcessor();
const stateManager = new StateManager('verify-fix', mockConfig, packetProcessor as any, mockMqttPublisher, 'homenet');

// Verification
const testChunk = Buffer.from('AA55', 'hex');
let received = false;

eventBus.on('raw-data', (data) => {
  console.log(`Received raw-data: ${data}`);
  if (data === 'aa55') {
    received = true;
    console.log('Verification SUCCESS: raw-data event emitted correctly.');
  } else {
    console.log(`Verification FAILED: Expected 'aa55', got '${data}'`);
  }
});

console.log('Sending chunk...');
stateManager.processIncomingData(testChunk);

if (!received) {
  console.log('Verification FAILED: No raw-data event received.');
  process.exit(1);
} else {
  process.exit(0);
}
