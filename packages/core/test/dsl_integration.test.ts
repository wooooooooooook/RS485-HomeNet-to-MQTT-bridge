import { describe, it, expect } from 'vitest';
import { loadYamlConfig } from '../src/config/yaml-loader.js';
import { GenericDevice } from '../src/protocol/devices/generic.device.js';
import { ProtocolConfig, DeviceConfig } from '../src/protocol/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('DSL Integration', () => {
    const tempConfigPath = path.join(__dirname, 'temp_dsl_config.yaml');

    it('should load YAML with !lambda and execute logic in GenericDevice', async () => {
        const yamlContent = `
homenet_bridge:
  uart:
    baud_rate: 9600
  packet_defaults:
    rx_length: 5
  light:
    - name: "Test Light"
      state_on: !lambda |-
        if (data[0] === 0x01) return "ON";
        return "";
      command_on: !lambda |-
        return [0x01, 0x02, 0x03, 0x04, 0x05];
`;
        await fs.writeFile(tempConfigPath, yamlContent);

        const config = await loadYamlConfig(tempConfigPath);
        const lightConfig = config.homenet_bridge.light[0];
        const protocolConfig: ProtocolConfig = { packet_defaults: config.homenet_bridge.packet_defaults };

        const device = new GenericDevice(lightConfig as DeviceConfig, protocolConfig);

        // Test State Parsing
        const packet = [0x01, 0x00, 0x00, 0x00, 0x00];
        const parsed = device.parseData(packet);
        expect(parsed).toEqual({ on: 'ON' });

        // Test Command Construction
        const command = device.constructCommand('on');
        expect(command).toEqual([0x01, 0x02, 0x03, 0x04, 0x05]);

        await fs.unlink(tempConfigPath);
    });
});
