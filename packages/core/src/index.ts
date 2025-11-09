import dotenv from 'dotenv';
import { SerialPort } from 'serialport';
import mqtt from 'mqtt';

dotenv.config();

export interface BridgeOptions {
  serialPath: string;
  baudRate: number;
  mqttUrl: string;
}

export class HomeNetBridge {
  private port: SerialPort;
  private client: mqtt.MqttClient;

  constructor(options: BridgeOptions) {
    this.port = new SerialPort({ path: options.serialPath, baudRate: options.baudRate });
    this.client = mqtt.connect(options.mqttUrl);
  }

  start() {
    this.port.on('data', (data) => {
      this.client.publish('homenet/raw', data.toString());
    });
  }
}

export function createBridge(options: BridgeOptions) {
  return new HomeNetBridge(options);
}
