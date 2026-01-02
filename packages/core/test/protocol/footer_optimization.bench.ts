import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser.js';
import { Buffer } from 'buffer';

describe('PacketParser Footer Optimization Performance', () => {
  it('measures performance of noisy footer scenario', () => {
    // Protocol with Header 0xAA and Footer 0x55, Add Checksum
    const parser = new PacketParser({
      rx_header: [0xAA],
      rx_footer: [0x55],
      rx_checksum: 'add',
    });

    // Create a large buffer starting with Header 0xAA
    // Filled with many 0x55 (fake footers)
    // The real footer is at the very end.
    const size = 15000;
    const buf = Buffer.alloc(size);
    buf[0] = 0xAA; // Header

    // Fill with 0x55 (Footer) but ensure checksum fails
    // 0x55 is the footer.
    // We want 0x55 to appear frequently in the data.
    for (let i = 1; i < size - 2; i++) {
        // Every 2nd byte is 0x55
        if (i % 2 === 0) {
            buf[i] = 0x55;
        } else {
            buf[i] = 0x01;
        }
    }

    // Set the last byte as the real footer
    buf[size - 1] = 0x55;

    // Calculate Checksum
    let sum = 0;
    for (let i = 0; i < size - 2; i++) {
        sum += buf[i];
    }
    buf[size - 2] = sum & 0xFF;

    const start = process.hrtime.bigint();
    const packets = parser.parseChunk(buf);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1e6;
    console.log(`Parsed ${packets.length} packet in ${elapsedMs.toFixed(2)} ms with size ${size}`);

    expect(packets.length).toBe(1);
    expect(packets[0].length).toBe(size);
  });
});
