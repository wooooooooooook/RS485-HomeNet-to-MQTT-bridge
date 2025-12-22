import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryManager } from '../src/mqtt/discovery-manager.js';
import { MqttPublisher } from '../src/transports/mqtt/publisher.js';
import { MqttSubscriber } from '../src/transports/mqtt/subscriber.js';
import { HomenetBridgeConfig } from '../src/config/types.js';
import { eventBus } from '../src/service/event-bus.js';

describe('DiscoveryManager', () => {
  let discoveryManager: DiscoveryManager;
  let mockPublisher: any;
  let mockSubscriber: any;
  let mockConfig: HomenetBridgeConfig;

  beforeEach(() => {
    eventBus.removeAllListeners();

    mockPublisher = {
      publish: vi.fn(),
    } as unknown as MqttPublisher;

    mockSubscriber = {
      subscribe: vi.fn(),
    } as unknown as MqttSubscriber;

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
      switch: [{ id: 'switch1', name: 'Test Switch', type: 'switch', state: {} }],
      devices: [
        {
          id: 'subpanel',
          name: 'Subpanel',
          manufacturer: 'Homenet',
          model: 'Panel V2',
          sw_version: '1.2.3',
          area: 'Entrance',
        },
      ],
      sensor: [
        {
          id: 'sensor1',
          name: 'Test Sensor',
          type: 'sensor',
          device_class: 'temperature',
          unit_of_measurement: '°C',
          state_class: 'measurement',
          state: {},
        },
        {
          id: 'linked_sensor',
          name: 'Linked Sensor',
          type: 'sensor',
          discovery_linked_id: 'switch1',
          state: {},
        },
        {
          id: 'device_sensor',
          name: 'Device Sensor',
          type: 'sensor',
          device: 'subpanel',
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
      light: [
        {
          id: 'always_on_light',
          name: 'Always Light',
          type: 'light',
          discovery_always: true,
          area: 'Living Room',
          state: {},
        },
      ],
    } as any;

    const mqttTopicPrefix = 'homenet2mqtt/homedevice1';

    discoveryManager = new DiscoveryManager(
      'main',
      mockConfig,
      mockPublisher,
      mockSubscriber,
      mqttTopicPrefix,
    );
    discoveryManager.setup();
  });

  it('상태 패킷 수신 후에만 스위치 디스커버리를 발행한다', () => {
    discoveryManager.discover();

    const switchTopic = 'homeassistant/switch/homenet_main_switch1/config';
    expect(
      mockPublisher.publish.mock.calls.filter((args: any[]) => args[0] === switchTopic).length,
    ).toBe(0);

    eventBus.emit('state:changed', { entityId: 'switch1', state: {}, portId: 'main' });

    const call = mockPublisher.publish.mock.calls.find((args: any[]) => args[0] === switchTopic);
    expect(call).toBeDefined();

    const payload = JSON.parse(call[1]);
    expect(payload.unique_id).toBe('homenet_main_switch1');
    expect(payload.default_entity_id).toBe('switch.test_switch');
    expect(payload.device.identifiers).toEqual(['homenet_bridge_device_main']);
    expect(payload.device.name).toBe('Homenet Bridge (main)');
    expect(payload.value_template).toBe('{{ value_json.state }}');
    expect(payload.payload_on).toBe('ON');
    expect(payload.payload_off).toBe('OFF');
    expect(payload.command_topic).toBe('homenet2mqtt/homedevice1/switch1/set');
  });

  it('연결된 엔티티 상태를 받은 경우 링크된 센서까지 함께 발행한다', () => {
    discoveryManager.discover();

    const sensorTopic = 'homeassistant/sensor/homenet_main_linked_sensor/config';
    expect(
      mockPublisher.publish.mock.calls.filter((args: any[]) => args[0] === sensorTopic).length,
    ).toBe(0);

    eventBus.emit('state:changed', { entityId: 'switch1', state: {}, portId: 'main' });

    const call = mockPublisher.publish.mock.calls.find((args: any[]) => args[0] === sensorTopic);
    expect(call).toBeDefined();
    const payload = JSON.parse(call[1]);

    expect(payload.unique_id).toBe('homenet_main_linked_sensor');
    expect(payload.default_entity_id).toBe('sensor.linked_sensor');
    expect(payload.value_template).toBe('{{ value_json.value }}');
  });

  it('discovery_always 플래그가 있으면 상태 없이 즉시 발행한다', () => {
    discoveryManager.discover();

    const lightTopic = 'homeassistant/light/homenet_main_always_on_light/config';
    const call = mockPublisher.publish.mock.calls.find((args: any[]) => args[0] === lightTopic);
    expect(call).toBeDefined();

    const payload = JSON.parse(call[1]);
    expect(payload.unique_id).toBe('homenet_main_always_on_light');
    expect(payload.command_topic).toBe('homenet2mqtt/homedevice1/always_on_light/set');
    expect(payload.suggested_area).toBe('Living Room');
    expect(payload.device.suggested_area).toBeUndefined();
  });

  it('디바이스 메타데이터와 영역 정보를 Discovery에 반영한다', () => {
    discoveryManager.discover();

    const sensorTopic = 'homeassistant/sensor/homenet_main_device_sensor/config';
    eventBus.emit('state:changed', { entityId: 'device_sensor', state: {}, portId: 'main' });

    const call = mockPublisher.publish.mock.calls.find((args: any[]) => args[0] === sensorTopic);
    expect(call).toBeDefined();

    const payload = JSON.parse(call[1]);
    expect(payload.unique_id).toBe('homenet_main_device_sensor');
    expect(payload.device).toEqual({
      identifiers: ['homenet_device_main_subpanel'],
      name: 'Subpanel',
      manufacturer: 'Homenet',
      model: 'Panel V2',
      sw_version: '1.2.3',
      suggested_area: 'Entrance',
    });
    expect(payload.suggested_area).toBeUndefined();
  });

  it('엔티티 이름 변경 시 새 이름으로 디스커버리를 재발행한다', () => {
    vi.useFakeTimers();

    discoveryManager.discover();
    eventBus.emit('state:changed', { entityId: 'switch1', state: {}, portId: 'main' });
    mockPublisher.publish.mockClear();

    const topic = 'homeassistant/switch/homenet_main_switch1/config';

    eventBus.emit('entity:renamed', { entityId: 'switch1', newName: 'Renamed Switch' });

    expect(mockPublisher.publish).toHaveBeenCalledWith(topic, '', { retain: true });

    const publishesBeforeDelay = mockPublisher.publish.mock.calls.filter(
      (args: any[]) => args[0] === topic && args[1],
    );
    expect(publishesBeforeDelay.length).toBe(0);

    vi.advanceTimersByTime(2000);

    const publishCalls = mockPublisher.publish.mock.calls.filter(
      (args: any[]) => args[0] === topic && args[1],
    );
    expect(publishCalls.length).toBeGreaterThan(0);

    const payload = JSON.parse(publishCalls[publishCalls.length - 1][1]);
    expect(payload.name).toBe('Renamed Switch');
    expect(payload.default_entity_id).toBe('switch.renamed_switch');

    vi.useRealTimers();
  });
});
