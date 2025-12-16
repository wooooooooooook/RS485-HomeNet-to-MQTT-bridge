import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MqttSubscriber } from '../src/transports/mqtt/subscriber.js';
import { MqttClient } from '../src/transports/mqtt/mqtt.client.js';
import { HomenetBridgeConfig } from '../src/config/types.js';
import { PacketProcessor } from '../src/protocol/packet-processor.js';
import { Duplex } from 'stream';
import { eventBus } from '../src/service/event-bus.js';
import { CommandManager } from '../src/service/command.manager.js';

describe('Climate Command Packet Generation', () => {
  let mqttSubscriber: MqttSubscriber;
  let mockMqttClient: any;
  let mockConfig: HomenetBridgeConfig;
  let mockPacketProcessor: any;
  let mockSerialPort: any;
  let commandManager: CommandManager;
  let capturedCommands: Array<{ entity: string; command: string; value?: any; packet: string }> =
    [];

  beforeEach(() => {
    capturedCommands = [];

    // Clear event listeners
    eventBus.removeAllListeners('command-packet');

    // Mock MQTT client
    mockMqttClient = {
      client: {
        on: vi.fn(),
        subscribe: vi.fn((topic, callback) => callback && callback(null)),
      },
    } as unknown as MqttClient;

    // Mock serial port
    mockSerialPort = {
      write: vi.fn(),
    } as unknown as Duplex;

    // Mock config with climate entity
    const serial = {
      portId: 'main',
      path: '/dev/ttyUSB0',
      baud_rate: 9600,
      data_bits: 8,
      parity: 'none',
      stop_bits: 1,
    } as any;

    mockConfig = {
      serial,
      serials: [serial],
      mqtt: { brokerUrl: 'mqtt://localhost' },
      packet_defaults: {
        rx_timeout: '10ms',
        tx_delay: '50ms',
        tx_timeout: '500ms',
        tx_retry_cnt: 3,
        rx_header: [0xb0],
        rx_checksum: 'samsung_rx',
        tx_checksum: 'samsung_tx',
      },
      climate: [
        {
          id: 'room_0_heater',
          name: 'Room 0 Heater',
          type: 'climate',
          visual: {
            min_temperature: '5 °C',
            max_temperature: '40 °C',
            temperature_step: '1 °C',
          },
          state: {
            data: [0x7c, 0x01],
          },
          state_temperature_current: {
            offset: 4,
            length: 1,
          },
          state_temperature_target: {
            offset: 3,
            length: 1,
          },
          state_off: {
            offset: 2,
            data: [0x00],
            mask: [0x01],
          },
          state_heat: {
            offset: 2,
            data: [0x01],
            mask: [0x01],
          },
          command_off: {
            data: [0xae, 0x7d, 0x01, 0x00, 0x00, 0x00, 0x00],
            ack: [0x7d, 0x01, 0x00],
          },
          command_heat: {
            data: [0xae, 0x7d, 0x01, 0x01, 0x00, 0x00, 0x00],
            ack: [0x7d, 0x01, 0x01],
          },
          command_temperature: {
            type: 'lambda',
            code: 'uint8_t target = x;\nreturn {{0xAE, 0x7F, 0x01, target, 0x00, 0x00, 0x00},{0x7F, 0x01, target}};',
          },
        },
      ],
    } as any;

    // Mock PacketProcessor - we'll make it return actual packets
    mockPacketProcessor = {
      constructCommandPacket: vi.fn((entity, commandName, value) => {
        // Simulate command packet construction
        if (entity.id === 'room_0_heater') {
          if (commandName === 'off' && entity.command_off?.data) {
            // Return command_off data + checksum
            return [...entity.command_off.data, 0x00]; // Simplified checksum
          }
          if (commandName === 'heat' && entity.command_heat?.data) {
            return [...entity.command_heat.data, 0x00];
          }
          if (commandName === 'temperature' && value !== undefined) {
            // Simulate lambda execution for temperature
            return [0xae, 0x7f, 0x01, value, 0x00, 0x00, 0x00, 0x00];
          }
        }
        return null;
      }),
    } as unknown as PacketProcessor;

    // Listen to command-packet events
    eventBus.on('command-packet', (data) => {
      capturedCommands.push(data);
    });

    commandManager = new CommandManager(mockSerialPort, mockConfig, 'main');

    const topicPrefix = 'homenet2mqtt/homedevice1';

    mqttSubscriber = new MqttSubscriber(
      mockMqttClient,
      'main',
      mockConfig,
      mockPacketProcessor,
      commandManager,
      topicPrefix,
    );
  });

  it('should generate command packet for climate mode set to off', async () => {
    const topic = 'homenet2mqtt/homedevice1/room_0_heater/mode/set';
    const message = Buffer.from('off');

    // Simulate MQTT message reception
    await (mqttSubscriber as any).handleMqttMessage(topic, message);

    // Verify packet processor was called
    // Note: subscriber converts 'mode' -> 'off' and passes 'off' as both commandName AND value
    expect(mockPacketProcessor.constructCommandPacket).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'room_0_heater' }),
      'off',
      'off', // mode value is passed here
    );

    // Verify serial port write was called
    expect(mockSerialPort.write).toHaveBeenCalled();

    // Verify event was emitted
    expect(capturedCommands).toHaveLength(1);
    expect(capturedCommands[0]).toMatchObject({
      entity: 'Room 0 Heater',
      command: 'off',
    });
  });

  it('should generate command packet for climate temperature set', async () => {
    const topic = 'homenet2mqtt/homedevice1/room_0_heater/temperature/set';
    const message = Buffer.from('18');

    // Simulate MQTT message reception
    await (mqttSubscriber as any).handleMqttMessage(topic, message);

    // Verify packet processor was called with value 18
    expect(mockPacketProcessor.constructCommandPacket).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'room_0_heater' }),
      'temperature',
      18,
    );

    // Verify serial port write was called
    expect(mockSerialPort.write).toHaveBeenCalled();

    // Verify event was emitted
    expect(capturedCommands).toHaveLength(1);
    expect(capturedCommands[0]).toMatchObject({
      entity: 'Room 0 Heater',
      command: 'temperature',
      value: 18,
    });
  });

  it('should handle multiple command topics correctly', async () => {
    // Send mode command
    await (mqttSubscriber as any).handleMqttMessage(
      'homenet2mqtt/homedevice1/room_0_heater/mode/set',
      Buffer.from('heat'),
    );

    // Send temperature command
    await (mqttSubscriber as any).handleMqttMessage(
      'homenet2mqtt/homedevice1/room_0_heater/temperature/set',
      Buffer.from('22.5'),
    );

    expect(mockPacketProcessor.constructCommandPacket).toHaveBeenCalledTimes(2);
    expect(capturedCommands).toHaveLength(2);

    expect(capturedCommands[0].command).toBe('heat');
    expect(capturedCommands[1].command).toBe('temperature');
    expect(capturedCommands[1].value).toBe(22.5);
  });
});
