// Debug script to analyze why packets are not matching

const packets = [
    "828304263000005f",
    "8280042218000040",
    "f6040103000000fe",
    "828001231500003b"
];

// Convert hex string to byte array
function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
}

// Calculate ADD checksum
function calculateChecksum(bytes) {
    let sum = 0;
    for (const byte of bytes) {
        sum += byte;
    }
    return sum & 0xFF;
}

console.log("=== Packet Analysis ===\n");

packets.forEach((packetHex, index) => {
    console.log(`Packet ${index + 1}: ${packetHex}`);
    const bytes = hexToBytes(packetHex);
    console.log(`  Bytes: [${bytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    // Verify checksum (last byte should be checksum of previous bytes)
    const dataBytes = bytes.slice(0, -1);
    const checksumByte = bytes[bytes.length - 1];
    const calculatedChecksum = calculateChecksum(dataBytes);
    console.log(`  Checksum: 0x${checksumByte.toString(16)} (calculated: 0x${calculatedChecksum.toString(16)}) - ${checksumByte === calculatedChecksum ? 'VALID' : 'INVALID'}`);

    // Analyze structure based on commax.homenet_bridge.yaml patterns
    console.log(`  First byte (header): 0x${bytes[0].toString(16).padStart(2, '0')}`);
    console.log(`  Second byte: 0x${bytes[1].toString(16).padStart(2, '0')}`);
    console.log(`  Third byte (ID): 0x${bytes[2].toString(16).padStart(2, '0')}`);

    // Try to match against known patterns
    const firstByte = bytes[0];
    if ((firstByte & 0xF0) === 0x80) {
        console.log(`  → Possible CLIMATE state packet (0x8X)`);
        console.log(`     Masked with 0xF9: 0x${(firstByte & 0xF9).toString(16)}`);
        console.log(`     Expected for heater: 0x80`);
        console.log(`     Match: ${(firstByte & 0xF9) === 0x80 ? 'YES' : 'NO'}`);
    } else if ((firstByte & 0xF0) === 0xF0) {
        console.log(`  → Possible FAN state packet (0xFX)`);
        console.log(`     Masked with 0xF1: 0x${(firstByte & 0xF1).toString(16)}`);
        console.log(`     Expected for fan: 0xF0`);
        console.log(`     Match: ${(firstByte & 0xF1) === 0xF0 ? 'YES' : 'NO'}`);
    }

    console.log("");
});
