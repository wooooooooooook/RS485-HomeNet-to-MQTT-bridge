import type { BridgeErrorPayload, BridgeErrorSeverity, BridgeErrorSource } from '../types/index.js';

const normalizeMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value && typeof (value as { message?: string }).message === 'string') {
    return (value as { message: string }).message;
  }
  return JSON.stringify(value);
};

export const createBridgeErrorPayload = ({
  code,
  message,
  detail,
  source,
  portId,
  severity = 'error',
  retryable = true,
}: {
  code: string;
  message?: string;
  detail?: string;
  source: BridgeErrorSource;
  portId?: string;
  severity?: BridgeErrorSeverity;
  retryable?: boolean;
}): BridgeErrorPayload => ({
  code,
  message,
  detail,
  source,
  portId,
  severity,
  retryable,
  timestamp: new Date().toISOString(),
});

export const formatBridgeErrorMessage = (error?: BridgeErrorPayload | string | null): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.detail || error.code;
};

export const mapSerialError = (error: unknown, portId?: string): BridgeErrorPayload => {
  const message = normalizeMessage(error);
  const code = (error as { code?: string })?.code;
  let errorCode = 'SERIAL_CONNECT_FAILED';

  if (message.includes('유효한 path가 필요')) {
    errorCode = 'SERIAL_PATH_MISSING';
  } else if (code === 'ENOENT') {
    errorCode = 'SERIAL_PATH_NOT_FOUND';
  } else if (code === 'EACCES') {
    errorCode = 'SERIAL_PERMISSION_DENIED';
  } else if (code === 'EBUSY') {
    errorCode = 'SERIAL_PORT_BUSY';
  }

  return createBridgeErrorPayload({
    code: errorCode,
    message,
    detail: code,
    source: 'serial',
    portId,
    severity: 'error',
    retryable: true,
  });
};

export const mapConfigLoadError = (error: unknown, portId?: string): BridgeErrorPayload => {
  const message = normalizeMessage(error);
  return createBridgeErrorPayload({
    code: 'CORE_CONFIG_LOAD_FAILED',
    message,
    detail: message,
    source: 'core',
    portId,
    severity: 'error',
    retryable: false,
  });
};

export const mapMqttError = (error: unknown, portId?: string): BridgeErrorPayload => {
  const message = normalizeMessage(error);
  const code = (error as { code?: string })?.code;
  let errorCode = 'MQTT_CONNECT_FAILED';

  if (message.toLowerCase().includes('not authorized')) {
    errorCode = 'MQTT_AUTH_FAILED';
  } else if (code && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) {
    errorCode = 'MQTT_CONNECT_FAILED';
  }

  return createBridgeErrorPayload({
    code: errorCode,
    message,
    detail: code,
    source: 'mqtt',
    portId,
    severity: 'error',
    retryable: true,
  });
};

export const mapMqttDisconnect = (portId?: string): BridgeErrorPayload => {
  return createBridgeErrorPayload({
    code: 'MQTT_DISCONNECTED',
    message: 'MQTT connection lost',
    source: 'mqtt',
    portId,
    severity: 'warning',
    retryable: true,
  });
};

export const mapBridgeStartError = (error: unknown, portId?: string): BridgeErrorPayload => {
  const message = normalizeMessage(error);
  const code = (error as { code?: string })?.code;
  const serialErrorCodes = ['ENOENT', 'EACCES', 'EBUSY'];

  if (
    message.includes('serial(') ||
    message.includes('시리얼') ||
    (code && serialErrorCodes.includes(code))
  ) {
    return mapSerialError(error, portId);
  }

  if (message.toLowerCase().includes('mqtt')) {
    return mapMqttError(error, portId);
  }

  return createBridgeErrorPayload({
    code: 'CORE_START_FAILED',
    message,
    detail: message,
    source: 'core',
    portId,
    severity: 'error',
    retryable: true,
  });
};
