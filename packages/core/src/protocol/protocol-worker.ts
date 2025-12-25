
import { parentPort } from 'node:worker_threads';
import { PacketParser } from './packet-parser.js';
import { PacketDefaults } from './types.js';
import { Buffer } from 'buffer';

if (parentPort) {
    let parser: PacketParser | null = null;

    parentPort.on('message', (message: { type: string; payload: any }) => {
        try {
            if (message.type === 'init') {
                const defaults = message.payload as PacketDefaults;
                parser = new PacketParser(defaults);
            } else if (message.type === 'chunk') {
                if (!parser) return;

                // workerData로 넘어온 buffer는 Uint8Array일 수 있음
                const chunk = message.payload instanceof Buffer
                    ? message.payload
                    : Buffer.from(message.payload);

                const packets = parser.parseChunk(chunk);

                if (packets.length > 0) {
                    // Send packets back
                    parentPort?.postMessage({
                        type: 'packets',
                        payload: packets
                    });
                }
            }
        } catch (error) {
            // 심각한 오류 발생 시 부모에게 알림 (선택 사항)
            // parentPort?.postMessage({ type: 'error', error });
        }
    });
}
