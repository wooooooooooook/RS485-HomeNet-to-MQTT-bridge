import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryManager } from '../src/mqtt/discovery-manager.js';
import { MqttPublisher } from '../src/transports/mqtt/publisher.js';
import { MqttSubscriber } from '../src/transports/mqtt/subscriber.js';
import { HomenetBridgeConfig } from '../src/config/types.js';

describe('DiscoveryManager', () => {
  let discoveryManager: DiscoveryManager;
  let mockPublisher: any;
  let mockSubscriber: any;
  let mockConfig: HomenetBridgeConfig;

  beforeEach(() => {
    mockPublisher = {
      publish: vi.fn(),
    } as unknown as MqttPublisher;

    mockSubscriber = {
      subscribe: vi.fn(),
    } as unknown as MqttSubscriber;

    mockConfig = {
      serial: { port: '/dev/ttyUSB0', baudRate: 9600 } as any,
      mqtt: { brokerUrl: 'mqtt://localhost' },
      switch: [{ id: 'switch1', name: 'Test Switch', type: 'switch', state: {} }],
      sensor: [
        {
          id: 'sensor1',
          name: 'Test Sensor',
          type: 'sensor',
          device_class: 'temperature',
          unit_of_measurement: '°C',
          state: {},
        },
      ],
      climate: [
        {
          id: 'climate1',
          name: 'Test Climate',
          type: 'climate',
          state: {},
          state_off: 'off',
          state_heat: 'heat',
          state_cool: 'cool',
        },
      ],
    } as any;

    discoveryManager = new DiscoveryManager(mockConfig, mockPublisher, mockSubscriber);
  });

  it('should publish discovery config for switch', () => {
    discoveryManager.discover();

    expect(mockPublisher.publish).toHaveBeenCalledWith(
      'homeassistant/switch/homenet_switch1/config',
      expect.stringContaining('"name":"Test Switch"'),
      { retain: true },
    );

    const call = mockPublisher.publish.mock.calls.find(
      (args: any[]) => args[0] === 'homeassistant/switch/homenet_switch1/config',
    );
    const payload = JSON.parse(call[1]);

    expect(payload.unique_id).toBe('homenet_switch1');
    expect(payload.device.identifiers).toEqual(['homenet_bridge_device']);
    expect(payload.device.name).toBe('Homenet Bridge');
    expect(payload.value_template).toBe('{{ value_json.state }}');
    expect(payload.payload_on).toBe('ON');
    expect(payload.payload_off).toBe('OFF');
    expect(payload.command_topic).toBe('homenet/switch1/set');
    // state_on and state_off should not be present when using JSON with templates
    expect(payload.state_on).toBeUndefined();
    expect(payload.state_off).toBeUndefined();
  });

  it('should publish discovery config for sensor with device_class', () => {
    discoveryManager.discover();

    expect(mockPublisher.publish).toHaveBeenCalledWith(
      'homeassistant/sensor/homenet_sensor1/config',
      expect.stringContaining('"name":"Test Sensor"'),
      { retain: true },
    );

    const call = mockPublisher.publish.mock.calls.find(
      (args: any[]) => args[0] === 'homeassistant/sensor/homenet_sensor1/config',
    );
    const payload = JSON.parse(call[1]);

    expect(payload.unique_id).toBe('homenet_sensor1');
    expect(payload.device_class).toBe('temperature');
    expect(payload.unit_of_measurement).toBe('°C');
    expect(payload.value_template).toBe('{{ value_json.value }}');
  });

  it('should publish discovery config for climate', () => {
    discoveryManager.discover();

    expect(mockPublisher.publish).toHaveBeenCalledWith(
      'homeassistant/climate/homenet_climate1/config',
      expect.stringContaining('"name":"Test Climate"'),
      { retain: true },
    );

    const call = mockPublisher.publish.mock.calls.find(
      (args: any[]) => args[0] === 'homeassistant/climate/homenet_climate1/config',
    );
    const payload = JSON.parse(call[1]);

    expect(payload.unique_id).toBe('homenet_climate1');

    // Command topics should be separate
    expect(payload.mode_command_topic).toBe('homenet/climate1/mode/set');
    expect(payload.temperature_command_topic).toBe('homenet/climate1/temperature/set');

    // State topics should all point to the same topic with templates
    expect(payload.mode_state_topic).toBe('homenet/climate1/state');
    expect(payload.mode_state_template).toBe('{{ value_json.mode }}');

    expect(payload.temperature_state_topic).toBe('homenet/climate1/state');
    expect(payload.temperature_state_template).toBe('{{ value_json.target_temperature }}');

    expect(payload.current_temperature_topic).toBe('homenet/climate1/state');
    expect(payload.current_temperature_template).toBe('{{ value_json.current_temperature }}');

    // action_topic and action_template should not be present if state_action is not configured
    expect(payload.action_topic).toBeUndefined();
    expect(payload.action_template).toBeUndefined();

    expect(payload.modes).toEqual(['off', 'heat', 'cool']);
    expect(payload.temperature_unit).toBe('C');
    expect(payload.min_temp).toBe(15);
    expect(payload.max_temp).toBe(30);
    expect(payload.temp_step).toBe(1);

    // Should not have generic command_topic
    expect(payload.command_topic).toBeUndefined();
  });
});
