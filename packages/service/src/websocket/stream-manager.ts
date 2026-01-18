/**
 * WebSocket Stream Manager
 * Manages real-time communication between server and UI/Clients
 * Handles: MQTT Status, Device States, Raw Packets, Logs
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  logger,
  eventBus,
  StateChangedEvent,
  MqttMessageEvent,
  EntityErrorEvent,
  normalizePortId,
} from '@rs485-homenet/core';
import type { SerialConfig, HomenetBridgeConfig } from '@rs485-homenet/core/config/types';
import {
  maskMqttPassword,
  normalizeTopicParts,
  normalizeRawPacket,
  extractEntityIdFromTopic,
  isStateTopic,
  BASE_PREFIX_PARTS,
} from '../utils/helpers.js';
import { mapMqttDisconnect, mapMqttError } from '../utils/bridge-errors.js';
import type {
  StreamEvent,
  StreamMessage,
  RawPacketStreamMode,
  RawPacketPayload,
  StateChangeEvent,
  BridgeInstance,
} from '../types/index.js';

export interface StreamManagerContext {
  wss: WebSocketServer;
  getBridges: () => BridgeInstance[];
  getCurrentConfigs: () => HomenetBridgeConfig[];
}

interface StreamManagerState {
  latestStates: Map<string, StateChangeEvent>;
  topicPrefixToPortId: Map<string, string>;
  
  // Subscribers who explicitly requested raw packet stream
  rawPacketSubscribers: Map<WebSocket, RawPacketStreamMode>;
}

export function createStreamManager(ctx: StreamManagerContext) {
  const state: StreamManagerState = {
    latestStates: new Map(),
    topicPrefixToPortId: new Map(),
    rawPacketSubscribers: new Map(),
  };

  const rebuildPortMappings = () => {
    const nextMap = new Map<string, string>();
    ctx.getCurrentConfigs().forEach((config) => {
      const serial = config.serial as SerialConfig | undefined;
      if (!serial) return;
      const portId = normalizePortId(serial.portId, 0);
      nextMap.set(portId, portId);
    });
    state.topicPrefixToPortId = nextMap;
  };

  // ... (keeping helper functions as is, will rely on context)

  const extractPortIdFromTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);
    const hasBasePrefix =
      BASE_PREFIX_PARTS.length > 0 &&
      BASE_PREFIX_PARTS.every((segment, index) => parts[index] === segment);

    if (hasBasePrefix && parts.length > BASE_PREFIX_PARTS.length) {
      const inferred = parts[BASE_PREFIX_PARTS.length];
      return state.topicPrefixToPortId.get(inferred) ?? inferred;
    }

    if (parts.length >= 2) {
      const inferred = parts[1];
      return state.topicPrefixToPortId.get(inferred) ?? inferred;
    }
    return undefined;
  };

  const stopAllRawPacketListeners = () => {
    ctx.getBridges().forEach((instance) => instance.bridge.stopRawPacketListener());
  };

  const startAllRawPacketListeners = () => {
    ctx.getBridges().forEach((instance) => instance.bridge.startRawPacketListener());
  };

  const sendStreamEventSerialized = (socket: WebSocket, message: string) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(message);
  };

  const sendStreamEvent = <T>(socket: WebSocket, event: StreamEvent, payload: T) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const message: StreamMessage<T> = { event, data: payload };
    socket.send(JSON.stringify(message));
  };

  const broadcastStreamEvent = <T>(event: StreamEvent, payload: T) => {
    if (ctx.wss.clients.size === 0) return;
    const message = JSON.stringify({ event, data: payload });
    ctx.wss.clients.forEach((client) => {
      sendStreamEventSerialized(client as WebSocket, message);
    });
  };

  const sendToRawSubscribers = <T>(
    event: StreamEvent,
    payload: T,
    mode: RawPacketStreamMode | null = null,
  ) => {
    if (state.rawPacketSubscribers.size === 0) return;
    const message = JSON.stringify({ event, data: payload });
    state.rawPacketSubscribers.forEach((subscriberMode, client) => {
      if (mode && subscriberMode !== mode) return;
      if (client.readyState === WebSocket.OPEN) {
        sendStreamEventSerialized(client, message);
      }
    });
  };

  const getRawPacketMode = (value: unknown): RawPacketStreamMode => {
    return value === 'valid' ? 'valid' : 'all';
  };

  const getRequestUrl = (req?: IncomingMessage) => {
    if (!req?.url) return null;
    const host = req.headers?.host || 'localhost';
    return new URL(req.url, `http://${host}`);
  };

  const registerGlobalEventHandlers = () => {
    const broadcastStateChange = (stateChangeEvent: StateChangeEvent) => {
      state.latestStates.set(stateChangeEvent.topic, stateChangeEvent);
      broadcastStreamEvent('state-change', stateChangeEvent);
    };

    eventBus.on('state:changed', (event: StateChangedEvent) => broadcastStateChange(event));

    eventBus.on('mqtt-message', (data: MqttMessageEvent) => {
      const receivedAt = new Date().toISOString();
      const portId = data.portId ?? extractPortIdFromTopic(data.topic);
      broadcastStreamEvent('mqtt-message', {
        topic: data.topic,
        payload: data.payload,
        receivedAt,
        portId,
      });
      if (isStateTopic(data.topic)) {
        let parsedState: Record<string, unknown> = {};
        try {
          parsedState = JSON.parse(data.payload) as Record<string, unknown>;
        } catch {
          parsedState = {};
        }
        const stateChangeEvent: StateChangeEvent = {
          entityId: extractEntityIdFromTopic(data.topic),
          topic: data.topic,
          payload: data.payload,
          state: parsedState,
          timestamp: receivedAt,
          portId,
        };
        broadcastStateChange(stateChangeEvent);
      }
    });

    eventBus.on('command-packet', (data: unknown) => {
      broadcastStreamEvent('command-packet', data);
    });

    eventBus.on('parsed-packet', (data: unknown) => {
      broadcastStreamEvent('parsed-packet', data);
    });

    eventBus.on('raw-data-with-interval', (data: RawPacketPayload) => {
      sendToRawSubscribers(
        'raw-data-with-interval',
        normalizeRawPacket({ ...data, direction: 'RX' }),
        'all',
      );
    });

    eventBus.on('raw-valid-packet', (data: RawPacketPayload) => {
      sendToRawSubscribers(
        'raw-data-with-interval',
        normalizeRawPacket({ ...data, direction: 'RX' }),
        'valid',
      );
    });

    eventBus.on('raw-tx-packet', (data: { portId: string; payload: string; timestamp: string }) => {
      sendToRawSubscribers(
        'raw-data-with-interval',
        normalizeRawPacket({
          portId: data.portId,
          payload: data.payload,
          receivedAt: data.timestamp,
          interval: null,
          direction: 'TX',
        }),
        null,
      );
    });

    eventBus.on('packet-interval-stats', (data: unknown) => {
      sendToRawSubscribers('packet-interval-stats', data);
    });

    eventBus.on('activity-log:added', (data: unknown) => {
      broadcastStreamEvent('activity-log-added', data);
    });

    eventBus.on('entity:error', (data: EntityErrorEvent) => {
      broadcastStreamEvent('entity-error', data);
    });

    eventBus.on(
      'mqtt:status',
      (data: { state: 'connected' | 'connecting' | 'disconnected'; portId?: string }) => {
        broadcastStreamEvent('status', {
          state: data.state,
        });
      },
    );

    eventBus.on(
      'mqtt:error',
      (data: { message?: string; code?: string; portId?: string; error?: unknown }) => {
        const payload = mapMqttError(
          data.error ?? { message: data.message, code: data.code },
          data.portId,
        );
        broadcastStreamEvent('status', {
          state: 'error',
          error: payload,
        });
      },
    );

    eventBus.on('mqtt:disconnected', (data: { portId?: string }) => {
      const payload = mapMqttDisconnect(data.portId);
      broadcastStreamEvent('status', {
        state: 'disconnected',
        error: payload,
      });
    });
  };

  const registerWebSocketHandlers = () => {
    ctx.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      const requestUrl = getRequestUrl(req);
      let streamMqttUrl = requestUrl?.searchParams.get('mqttUrl') ?? '';
      if (!streamMqttUrl) {
        streamMqttUrl = maskMqttPassword(process.env.MQTT_URL?.trim() || 'mqtt://mq:1883');
      }

      const bridges = ctx.getBridges();
      // If no bridges (failed to start), status is 'idle'. Otherwise check if any is connected.
      const mqttState =
        bridges.length === 0
          ? 'idle'
          : bridges.some((b) => b.bridge.isMqttConnected)
            ? 'connected'
            : 'connecting';
      sendStreamEvent(socket, 'status', {
        state: mqttState,
        mqttUrl: streamMqttUrl,
      });
      state.latestStates.forEach((s) => sendStreamEvent(socket, 'state-change', s));

      socket.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message);
          if (parsed.command === 'start') {
            const mode = getRawPacketMode(parsed.mode);
            const wasEmpty = state.rawPacketSubscribers.size === 0;
            state.rawPacketSubscribers.set(socket, mode);
            if (wasEmpty) {
              logger.info('[service] UI requested to start streaming raw packets.');
              startAllRawPacketListeners();
            }
          } else if (parsed.command === 'stop') {
            if (
              state.rawPacketSubscribers.delete(socket) &&
              state.rawPacketSubscribers.size === 0
            ) {
              logger.info('[service] UI requested to stop streaming raw packets.');
              stopAllRawPacketListeners();
            }
          }
        } catch (error) {
          logger.warn({ err: error }, '[service] Invalid WebSocket message received');
        }
      });

      const heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.ping();
        }
      }, 15000);

      socket.on('close', () => {
        clearInterval(heartbeat);
        if (state.rawPacketSubscribers.delete(socket) && state.rawPacketSubscribers.size === 0) {
          stopAllRawPacketListeners();
        }
      });

      socket.on('error', () => {
        clearInterval(heartbeat);
        if (state.rawPacketSubscribers.delete(socket) && state.rawPacketSubscribers.size === 0) {
          stopAllRawPacketListeners();
        }
      });
    });
  };

  return {
    registerGlobalEventHandlers,
    registerWebSocketHandlers,
    rebuildPortMappings,
    getLatestStates: () => state.latestStates,
  };
}
