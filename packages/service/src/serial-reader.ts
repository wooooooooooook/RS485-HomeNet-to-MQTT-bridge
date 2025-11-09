import { EventEmitter } from 'node:events';
import type { SerialPortOpenOptions } from 'serialport';
import { SerialPort } from 'serialport';

export interface SerialReaderOptions {
  path: string;
  baudRate: number;
}

type SerialOptions = SerialPortOpenOptions<any>;

export interface SerialReaderDependencies {
  createPort?: (options: SerialOptions) => SerialPort;
}

export class SerialReader extends EventEmitter {
  private readonly port: SerialPort;

  constructor(options: SerialReaderOptions, dependencies: SerialReaderDependencies = {}) {
    super();

    const serialOptions: SerialOptions = {
      path: options.path,
      baudRate: options.baudRate,
      autoOpen: false,
    };

    const createPort = dependencies.createPort ?? ((opts: SerialOptions) => new SerialPort(opts));

    this.port = createPort(serialOptions);

    this.port.on('data', (data: Buffer) => {
      this.emit('data', data);
    });

    this.port.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.port.on('open', () => {
      this.emit('open');
    });

    this.port.on('close', () => {
      this.emit('close');
    });
  }

  async open() {
    if (this.port.isOpen) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.off('open', handleOpen);
        this.off('error', handleError);
      };

      const handleOpen = () => {
        cleanup();
        resolve();
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.once('open', handleOpen);
      this.once('error', handleError);

      try {
        this.port.open();
      } catch (error) {
        cleanup();
        reject(error as Error);
      }
    });
  }

  async close() {
    if (!this.port.isOpen) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.off('close', handleClose);
        this.off('error', handleError);
      };

      const handleClose = () => {
        cleanup();
        resolve();
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.once('close', handleClose);
      this.once('error', handleError);

      try {
        this.port.close();
      } catch (error) {
        cleanup();
        reject(error as Error);
      }
    });
  }

  isOpen() {
    return this.port.isOpen;
  }
}
