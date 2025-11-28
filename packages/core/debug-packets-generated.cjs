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
    // { id: 'cvnet', file: 'cvnet.homenet_bridge.yaml' },
    { id: 'ezville', file: 'ezville.homenet_bridge.yaml' },
    // { id: 'hyundai_imazu', file: 'hyundai_imazu.homenet_bridge.yaml' },
    { id: 'kocom', file: 'kocom.homenet_bridge.yaml' },
    // { id: 'commax', file: 'commax.homenet_bridge.yaml' },
    // { id: 'samsung_sds', file: 'samsung_sds.homenet_bridge.yaml' },
];

function calculateChecksum(header, data, type) {
    // data is body only
    const fullData = [...header, ...data];

    switch (type) {
        case 'add':
            return fullData.reduce((a, b) => a + b, 0) & 0xff;
        case 'add_no_header':
            return data.reduce((a, b) => a + b, 0) & 0xff;
        case 'xor':
            return fullData.reduce((a, b) => a ^ b, 0);
        case 'xor_no_header':
            return data.reduce((a, b) => a ^ b, 0);
        case 'samsung_rx': {
            let crc = 0xb0;
            for (const byte of data) {
                crc ^= byte;
            }
            if (data.length > 0 && data[0] < 0x7c) {
                crc ^= 0x80;
            }
            return crc;
        }
        case 'samsung_tx': {
            let crc = 0x00;
            for (const byte of data) {
                crc ^= byte;
            }
            crc ^= 0x80;
            return crc;
        }
        default:
            return 0;
    }
}

function calculateChecksum2(header, data, type) {
    switch (type) {
        case 'xor_add': {
            let crc = 0;
            let temp = 0;

            // Process header
            for (const byte of header) {
                crc += byte;
                temp ^= byte;
            }

            // Process data
            for (const byte of data) {
                crc += byte;
                temp ^= byte;
            }

            crc += temp;

            const high = temp & 0xff;
            const low = crc & 0xff;

            return [high, low];
        }
        default:
            return [0, 0];
    }
}

function getMaxOffset(deviceConfig) {
    let maxOffset = -1;

    // Helper to check an object for offset
    const check = (obj) => {
        if (obj && typeof obj === 'object') {
            if (typeof obj.offset === 'number') {
                // If 'data' is present, the used range is offset + data.length
                const length = Array.isArray(obj.data) ? obj.data.length : 1;
                const end = obj.offset + length - 1;
                if (end > maxOffset) maxOffset = end;
            }
        }
    };

    Object.keys(deviceConfig).forEach((key) => {
        if (key.startsWith('state_')) {
            check(deviceConfig[key]);
        }
    });

    return maxOffset;
}

function generatePacketsForDevice(deviceType, deviceConfig, defaults) {
    const packets = [];
    const deviceName = deviceConfig.name || 'Unknown';

    // Base state packet
    let baseState = null;
    if (deviceConfig.state && Array.isArray(deviceConfig.state.data)) {
        baseState = [...deviceConfig.state.data];
    }

    if (!baseState) return packets;

    // Determine required length based on max offset
    const maxOffset = getMaxOffset(deviceConfig);

    // Calculate target body length from defaults.rx_length
    let targetBodyLength = 0;
    if (defaults && defaults.rx_length) {
        const headerLength = defaults.rx_header ? defaults.rx_header.length : 0;
        const footerLength = defaults.rx_footer ? defaults.rx_footer.length : 0;
        const checksumLength = defaults.rx_checksum2
            ? 2
            : defaults.rx_checksum && defaults.rx_checksum !== 'none'
                ? 1
                : 0;
        targetBodyLength = defaults.rx_length - headerLength - footerLength - checksumLength;
    }

    let requiredLength = baseState.length;
    if (maxOffset >= requiredLength) {
        requiredLength = maxOffset + 1;
    }
    if (targetBodyLength > requiredLength) {
        requiredLength = targetBodyLength;
    }

    if (requiredLength > baseState.length) {
        // Pad with zeros
        const padding = new Array(requiredLength - baseState.length).fill(0);
        baseState = baseState.concat(padding);
    }

    packets.push({
        name: `${deviceName} (Base State)`,
        body: [...baseState],
    });

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

    variants.forEach((v) => {
        if (deviceConfig[v.key]) {
            const modified = applyMod(baseState, deviceConfig[v.key]);
            if (modified) {
                packets.push({
                    name: `${deviceName} (${v.suffix})`,
                    body: modified,
                });
            }
        }
    });

    // Special handling for thermostat temperatures (heuristic)
    if (
        deviceType === 'climate' &&
        deviceConfig.state_temperature_current &&
        deviceConfig.state_temperature_current.offset !== undefined
    ) {
        const offset = deviceConfig.state_temperature_current.offset;
        if (offset < baseState.length) {
            const tempPacket = [...baseState];
            // If mask is present for temperature (unlikely for current, but possible), we should respect it?
            // Usually current temp is a raw byte.
            // Let's set it to 25 (0x19).
            // If it's BCD encoded (samsung), 25 is 0x25.
            // Let's check 'decode' property.
            const isBcd = deviceConfig.state_temperature_current.decode === 'bcd';
            tempPacket[offset] = isBcd ? 0x25 : 25;

            // Also set target temperature if possible to make it realistic
            if (
                deviceConfig.state_temperature_target &&
                deviceConfig.state_temperature_target.offset !== undefined
            ) {
                const tOffset = deviceConfig.state_temperature_target.offset;
                const tIsBcd = deviceConfig.state_temperature_target.decode === 'bcd';
                if (tOffset < baseState.length) {
                    tempPacket[tOffset] = tIsBcd ? 0x26 : 26;
                }
            }

            packets.push({ name: `${deviceName} (Temp 25C/26C)`, body: tempPacket });
        }
    }

    // Special handling for fan speeds
    if (
        deviceType === 'fan' &&
        deviceConfig.state_speed &&
        deviceConfig.state_speed.offset !== undefined
    ) {
        const offset = deviceConfig.state_speed.offset;
        if (offset < baseState.length) {
            // Speed 1
            const speed1 = [...baseState];
            speed1[offset] = 1;
            packets.push({ name: `${deviceName} (Speed 1)`, body: speed1 });

            // Speed 2
            const speed2 = [...baseState];
            speed2[offset] = 2;
            packets.push({ name: `${deviceName} (Speed 2)`, body: speed2 });
        }
    }

    return packets;
}

MANUFACTURERS.forEach((mfg) => {
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
    const footer = defaults.rx_footer || [];
    const checksumType = defaults.rx_checksum || 'none';
    const checksum2Type = defaults.rx_checksum2;

    let allPackets = [];

    const deviceTypes = ['light', 'fan', 'climate', 'valve', 'switch', 'sensor', 'button'];

    deviceTypes.forEach((type) => {
        if (bridgeConfig[type] && Array.isArray(bridgeConfig[type])) {
            bridgeConfig[type].forEach((device) => {
                const devicePackets = generatePacketsForDevice(type, device, defaults);
                allPackets = allPackets.concat(devicePackets);
            });
        }
    });

    // Generate TS file content
    let tsContent = `export const ${mfg.id.toUpperCase()}_PACKETS: readonly (Buffer | number[])[] = [\n`;

    allPackets.forEach((pkt) => {
        const data = [...header, ...pkt.body];

        let checksumVal = 0;
        let checksum2Val = null;

        if (checksum2Type) {
            checksum2Val = calculateChecksum2(header, pkt.body, checksum2Type);
        } else if (checksumType !== 'none') {
            checksumVal = calculateChecksum(header, pkt.body, checksumType);
        }

        let fullPacket = [...data];
        if (checksum2Val) {
            fullPacket.push(...checksum2Val);
        } else if (checksumType !== 'none') {
            fullPacket.push(checksumVal);
        }
        fullPacket = [...fullPacket, ...footer];

        const hexStr = fullPacket.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ');
        tsContent += `  // ${pkt.name}\n`;
        tsContent += `  [${hexStr}],\n`;
    });

    tsContent += `];\n`;

    const outputPath = path.join(OUTPUT_DIR, `${mfg.id}.ts`);
    fs.writeFileSync(outputPath, tsContent);
    console.log(`Generated ${outputPath}`);
});

console.log('All done.');
