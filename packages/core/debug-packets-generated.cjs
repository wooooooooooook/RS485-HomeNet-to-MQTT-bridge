const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Define custom tag types for YAML parsing
const LambdaType = new yaml.Type('!lambda', {
    kind: 'scalar',
    construct: (data) => data,
});

const SCHEMA = yaml.DEFAULT_SCHEMA.extend([LambdaType]);

// Configuration map
const CONFIG_DIR = path.resolve(__dirname, 'config');
const OUTPUT_DIR = path.resolve(__dirname, '../../packages/simulator/src');

const MANUFACTURERS = [
    { id: 'cvnet', file: 'cvnet.homenet_bridge.yaml' },
    { id: 'ezville', file: 'ezville.homenet_bridge.yaml' },
    { id: 'hyundai_imazu', file: 'hyundai_imazu.homenet_bridge.yaml' },
    { id: 'kocom', file: 'kocom.homenet_bridge.yaml' },
    { id: 'commax', file: 'commax.homenet_bridge.yaml' },
    { id: 'samsung_sds', file: 'samsung_sds.homenet_bridge.yaml' },
];

function calculateChecksum(data, type, headerLength = 0) {
    // data includes header (if any) + body
    switch (type) {
        case 'add':
            return data.reduce((a, b) => a + b, 0) & 0xFF;
        case 'add_no_header':
            {
                let sum = 0;
                for (let i = 1; i < data.length; i++) {
                    sum += data[i];
                }
                return sum & 0xFF;
            }
        case 'xor':
            return data.reduce((a, b) => a ^ b, 0);
        case 'xor_add':
            return data.reduce((a, b) => a ^ b, 0);
        case 'samsung_rx':
            {
                const dataPart = data.slice(headerLength);
                let crc = 0xb0;
                for (const byte of dataPart) {
                    crc ^= byte;
                }
                if (dataPart.length > 0 && dataPart[0] < 0x7c) {
                    crc ^= 0x80;
                }
                return crc;
            }
        case 'samsung_tx':
             {
                // Simulator sending TX packets implies acting as device? 
                // Usually samsung_tx is for bridge sending to device.
                // If simulator simulates device, it sends RX packets (response).
                // But here we just calculate checksum as requested.
                const dataPart = data.slice(headerLength);
                let crc = 0x00;
                for (const byte of dataPart) {
                    crc ^= byte;
                }
                crc ^= 0x80;
                return crc;
             }
        default:
            return 0;
    }
}

function generatePacketsForDevice(deviceType, deviceConfig, defaults) {
    const packets = [];
    const deviceName = deviceConfig.name || 'Unknown';
    
    // Base state packet
    let baseState = null;
    if (deviceConfig.state && Array.isArray(deviceConfig.state.data)) {
        baseState = [...deviceConfig.state.data];
        packets.push({
            name: `${deviceName} (Base State)`,
            body: baseState
        });
    }

    if (!baseState) return packets;

    // Helper to apply modification
    const applyMod = (base, modConfig) => {
        if (!modConfig) return null;
        const modified = [...base];
        
        // Handle data replacement
        if (Array.isArray(modConfig.data)) {
            const offset = modConfig.offset || 0;
            for (let i = 0; i < modConfig.data.length; i++) {
                if (offset + i < modified.length) {
                    modified[offset + i] = modConfig.data[i];
                }
            }
            return modified;
        }
        return null; // Only support direct data replacement for now
    };

    // Generate variants
    const variants = [
        { key: 'state_on', suffix: 'ON' },
        { key: 'state_off', suffix: 'OFF' },
        { key: 'state_open', suffix: 'OPEN' },
        { key: 'state_closed', suffix: 'CLOSED' },
        { key: 'state_heat', suffix: 'HEAT' },
    ];

    variants.forEach(v => {
        if (deviceConfig[v.key]) {
            const modified = applyMod(baseState, deviceConfig[v.key]);
            if (modified) {
                packets.push({
                    name: `${deviceName} (${v.suffix})`,
                    body: modified
                });
            }
        }
    });

    // Special handling for fan speeds if simple offsets
    // Special handling for thermostat temperatures (heuristic)
    if (deviceType === 'climate' && deviceConfig.state_temperature_current && deviceConfig.state_temperature_current.offset !== undefined) {
        // Generate a few temperature examples
        const offset = deviceConfig.state_temperature_current.offset;
        if (offset < baseState.length) {
            const tempPacket = [...baseState];
            tempPacket[offset] = 25; // 25 degrees (simplified, assumes 1 byte raw)
            packets.push({ name: `${deviceName} (Current 25C)`, body: tempPacket });
        }
    }

    return packets;
}

MANUFACTURERS.forEach(mfg => {
    console.log(`Processing ${mfg.id}...`);
    const configPath = path.join(CONFIG_DIR, mfg.file);
    
    if (!fs.existsSync(configPath)) {
        console.warn(`Config file not found: ${configPath}`);
        return;
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(content, { schema: SCHEMA });
    const bridgeConfig = config.homenet_bridge;
    
    if (!bridgeConfig) return;

    const defaults = bridgeConfig.packet_defaults || {};
    const header = defaults.rx_header || [];
    // Some configs put footer in packet_defaults (cvnet), some imply it
    // We'll try to use what's defined. 
    // Note: The simulator logic in `index.ts` expects FULL packets including header/footer/checksum.
    // But `packet_defaults` might say `rx_header`.
    // The simulator usually needs to SEND packets that the BRIDGE receives.
    // So we should use `rx_header`, `rx_footer`, `rx_checksum`.
    
    const footer = defaults.rx_footer || [];
    const checksumType = defaults.rx_checksum || 'none';

    let allPackets = [];

    const deviceTypes = ['light', 'fan', 'climate', 'valve', 'switch', 'sensor', 'button'];
    
    deviceTypes.forEach(type => {
        if (bridgeConfig[type] && Array.isArray(bridgeConfig[type])) {
            bridgeConfig[type].forEach(device => {
                const devicePackets = generatePacketsForDevice(type, device, defaults);
                allPackets = allPackets.concat(devicePackets);
            });
        }
    });

    // Generate TS file content
    let tsContent = `export const ${mfg.id.toUpperCase()}_PACKETS: readonly (Buffer | number[])[] = [\n`;
    
    allPackets.forEach(pkt => {
        const data = [...header, ...pkt.body];
        
        // Calculate checksum
        // Checksum is calculated on (Header + Body) usually, but logic varies.
        // Our helper `calculateChecksum` supports header skipping if needed.
        // Core implementation of `packet-parser` typically verifies checksum on the buffer.
        
        // Special case for samsung_sds / commax?
        // Commax config: rx_header [], checksum 'add'.
        // Samsung config: rx_header [0xB0], checksum 'samsung_rx'.
        
        let checksumVal = 0;
        if (checksumType !== 'none') {
             checksumVal = calculateChecksum(data, checksumType, header.length);
        }

        let fullPacket = [...data];
        if (checksumType !== 'none') {
            fullPacket.push(checksumVal);
        }
        fullPacket = [...fullPacket, ...footer];

        const hexStr = fullPacket.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ');
        tsContent += `  // ${pkt.name}\n`;
        tsContent += `  [${hexStr}],\n`;
    });

    tsContent += `];\n`;

    const outputPath = path.join(OUTPUT_DIR, `${mfg.id}.ts`);
    fs.writeFileSync(outputPath, tsContent);
    console.log(`Generated ${outputPath}`);
});

console.log('All done.');