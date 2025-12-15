import { PacketParser } from '../src/protocol/packet-parser.js';
import { Buffer } from 'buffer';

const parser = new PacketParser({
    rx_header: [0xAA],
    rx_footer: [0x55],
    rx_checksum: 'add',
});

const packetData = [0xAA, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A];
let sum = 0;
for (const b of packetData) sum += b;
packetData.push(sum & 0xFF);
packetData.push(0x55);

const singlePacketBuffer = Buffer.from(packetData);
const count = 10000;
const largeChunk = Buffer.alloc(singlePacketBuffer.length * count);
for (let i = 0; i < count; i++) {
    singlePacketBuffer.copy(largeChunk, i * singlePacketBuffer.length);
}

console.log(`Running perf test with ${count} packets...`);
const start = process.hrtime.bigint();
parser.parseChunk(largeChunk);
const end = process.hrtime.bigint();

console.log(`Parsed ${count} packets in ${Number(end - start) / 1e6} ms`);
