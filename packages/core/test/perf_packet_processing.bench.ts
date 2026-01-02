import { PacketParser } from '../src/protocol/packet-parser.js';
import { Buffer } from 'buffer';

const parser = new PacketParser({
  rx_header: [0xaa],
  rx_footer: [0x55],
  rx_checksum: 'add',
});

const packetData = [0xaa, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a];
let sum = 0;
for (const b of packetData) sum += b;
packetData.push(sum & 0xff);
packetData.push(0x55);

const packetBuffer = Buffer.from(packetData);
const packetCount = 10000;
const totalBytes = packetBuffer.length * packetCount;
const byteStream = Buffer.alloc(totalBytes);
for (let i = 0; i < packetCount; i++) {
  packetBuffer.copy(byteStream, i * packetBuffer.length);
}

console.log(`1바이트 청크 벤치마크: ${packetCount} 패킷 (${totalBytes} 바이트)`);

const byteChunk = Buffer.alloc(1);
let parsedPackets = 0;
const start = process.hrtime.bigint();
for (let i = 0; i < byteStream.length; i++) {
  byteChunk[0] = byteStream[i];
  parsedPackets += parser.parseChunk(byteChunk).length;
}
const end = process.hrtime.bigint();

const elapsedMs = Number(end - start) / 1e6;
console.log(`Parsed packets: ${parsedPackets}`);
console.log(`Elapsed: ${elapsedMs.toFixed(2)} ms`);
