// packages/core/src/transports/serial/serial.factory.ts
import { Duplex } from 'stream';
import net from 'net';
import { SerialPort } from 'serialport';
import { isTcpConnection, waitForSerialDevice, openSerialPort } from './serial.connection.js';
import { SerialConfig } from '../../config/types.js';
import { logger } from '../../utils/logger.js';

export async function createSerialPortConnection(
  serialPath: string,
  serialConfig: SerialConfig,
): Promise<Duplex> {
  logger.info({ serialPath, baudRate: serialConfig.baud_rate }, '[serial] 시리얼 포트 연결 시도');

  let port: Duplex;
  if (isTcpConnection(serialPath)) {
    const [host, tcpPort] = serialPath.split(':');
    const portNumber = Number(tcpPort);

    const connectTcp = async (retries = 10, delayMs = 2000): Promise<net.Socket> => {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port: portNumber });

        const onConnect = () => {
          socket.removeListener('error', onError);
          resolve(socket);
        };

        const onError = async (err: Error) => {
          socket.removeListener('connect', onConnect);
          socket.destroy();

          if (retries > 0) {
            logger.warn({ err, remainingRetries: retries }, '[serial] TCP 연결 실패, 재시도 중...');
            await new Promise((r) => setTimeout(r, delayMs));
            try {
              const newSocket = await connectTcp(retries - 1, delayMs);
              resolve(newSocket);
            } catch (e) {
              reject(e);
            }
          } else {
            reject(err);
          }
        };

        socket.once('connect', onConnect);
        socket.once('error', onError);
      });
    };

    port = await connectTcp();
  } else {
    await waitForSerialDevice(serialPath);
    const serialPort = new SerialPort({
      path: serialPath,
      baudRate: serialConfig.baud_rate,
      dataBits: serialConfig.data_bits,
      parity: serialConfig.parity,
      stopBits: serialConfig.stop_bits,
      autoOpen: false,
    });
    port = serialPort;
    await openSerialPort(serialPort);
  }
  return port;
}
