<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import './lib/i18n';
  import type {
    BridgeInfo,
    BridgeSerialInfo,
    BridgeStatus,
    MqttMessageEvent,
    CommandPacket,
    RawPacketWithInterval,
    PacketStats,
    CommandInfo,
    UnifiedEntity,
    ParsedPacket,
    StateChangeEvent,
    ToastMessage,
    FrontendSettings,
    ActivityLog,
  } from './lib/types';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Header from './lib/components/Header.svelte';
  import Dashboard from './lib/views/Dashboard.svelte';
  import Analysis from './lib/views/Analysis.svelte';

  import LogConsentModal from './lib/components/LogConsentModal.svelte';
  import EntityDetail from './lib/components/EntityDetail.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
  import SettingsView from './lib/views/Settings.svelte';

  const MAX_PACKETS = 1000;

  // -- State --
  let activeView = $state<'dashboard' | 'analysis' | 'settings'>('dashboard');
  let selectedEntityId = $state<string | null>(null);
  let isSidebarOpen = $state(false);
  let showInactiveEntities = $state(false);

  let bridgeInfo = $state<BridgeInfo | null>(null);
  let infoLoading = $state(false);
  let infoError = $state('');
  let selectedPortId = $state<string | null>(null);
  let bridgeStatusByPort = $state(new Map<string, string>());

  let commandPackets = $state<CommandPacket[]>([]);
  type DeviceStateEntry = { payload: string; portId?: string };
  let deviceStates = $state(new Map<string, DeviceStateEntry>());
  let socket = $state<WebSocket | null>(null);
  let connectionStatus = $state<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  let statusMessage = $state('');
  let isStreaming = $state(false);

  // Command buttons state
  let availableCommands = $state<CommandInfo[]>([]);
  let commandsLoading = $state(false);
  let commandsError = $state('');
  // Generic input state map for various input types

  let executingCommands = $state(new Set<string>());

  let rawPackets = $state<RawPacketWithInterval[]>([]);
  let parsedPackets = $state<ParsedPacket[]>([]);
  let packetStatsByPort = $state(new Map<string, PacketStats>());
  let hasIntervalPackets = $state(false);
  let lastRawPacketTimestamp = $state<number | null>(null);
  let toasts = $state<ToastMessage[]>([]);
  const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const MAX_TOASTS = 4;
  const TOAST_DURATION = 5000;
  let toastCounter = 0;
  const DEFAULT_FRONTEND_SETTINGS: FrontendSettings = {
    toast: {
      stateChange: false,
      command: true,
    },
  };
  let frontendSettings = $state<FrontendSettings | null>(null);
  let settingsLoading = $state(false);
  let settingsError = $state('');
  let settingsSaving = $state(false);
  let renamingEntityId = $state<string | null>(null);
  let renameError = $state('');

  let activityLogs = $state<ActivityLog[]>([]);
  let activityLoading = $state(true);
  let activityError = $state('');

  let showConsentModal = $state(false);

  type StreamEvent =
    | 'status'
    | 'mqtt-message'
    | 'raw-data'
    | 'raw-data-with-interval'
    | 'packet-interval-stats'
    | 'command-packet'
    | 'parsed-packet'
    | 'state-change'
    | 'activity-log-added';

  type StreamMessage<T = unknown> = {
    event: StreamEvent;
    data: T;
  };

  const normalizeTopicParts = (topic: string) => topic.split('/').filter(Boolean);
  const getBasePrefixParts = () =>
    normalizeTopicParts(bridgeInfo?.bridges?.[0]?.mqttTopicPrefix ?? '');

  const getKnownPortIds = () =>
    bridgeInfo?.bridges?.flatMap((bridge) => bridge.serials.map((serial) => serial.portId)) ?? [];
  // portId는 명시적으로 전달받은 값만 사용합니다. 추론하여 기본값으로 대체하지 않습니다.
  const getExplicitPortId = (explicit?: string | null, topic?: string): string | undefined => {
    // 명시적으로 전달받은 portId가 있으면 사용
    if (explicit) return explicit;
    // topic에서 추출 시도 (topic 구조에서 portId를 알 수 있는 경우만)
    if (topic) {
      const extracted = extractPortIdFromTopic(topic);
      if (extracted) return extracted;
    }
    return undefined;
  };

  const extractPortIdFromTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);
    const basePrefix = getBasePrefixParts();
    const hasBasePrefix =
      basePrefix.length > 0 && basePrefix.every((segment, index) => parts[index] === segment);

    if (hasBasePrefix && parts.length > basePrefix.length) {
      return parts[basePrefix.length];
    }

    if (parts.length >= 2) {
      return parts[1];
    }
    return null;
  };

  const extractEntityIdFromTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);
    const stateIndex = parts.findIndex((part) => part === 'state');
    if (stateIndex > 0) {
      return parts[stateIndex - 1];
    }

    if (parts.length >= 3) {
      return parts[parts.length - 2];
    }

    return parts.at(-1) ?? topic;
  };

  const isBridgeStatusTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);
    return parts.slice(-2).join('/') === 'bridge/status';
  };

  const isStateTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);
    return parts.length >= 3 && parts[parts.length - 1] === 'state';
  };

  const normalizeRawPacket = (
    data: Partial<RawPacketWithInterval> & { payload?: string },
  ): RawPacketWithInterval => ({
    topic: data.topic ?? 'homenet2mqtt/raw',
    payload: data.payload ?? '',
    receivedAt: data.receivedAt ?? new Date().toISOString(),
    interval: typeof data.interval === 'number' ? data.interval : null,
    portId: getExplicitPortId(data.portId, data.topic),
  });

  const appendRawPacket = (packet: RawPacketWithInterval) => {
    rawPackets = [...rawPackets, packet].slice(-MAX_PACKETS);
  };

  const clearToastTimer = (id: string) => {
    const timeout = toastTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      toastTimeouts.delete(id);
    }
  };

  const removeToast = (id: string) => {
    clearToastTimer(id);
    toasts = toasts.filter((toast) => toast.id !== id);
  };

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${toastCounter++}`;
    const newToast = { ...toast, id };
    const next = [...toasts, newToast];

    while (next.length > MAX_TOASTS) {
      const removed = next.shift();
      if (removed) {
        clearToastTimer(removed.id);
      }
    }

    toasts = next;

    const timeout = setTimeout(() => removeToast(id), TOAST_DURATION);
    toastTimeouts.set(id, timeout);
  };

  const formatToastValue = (value: unknown): string => {
    if (value === null || typeof value === 'undefined') {
      return '—';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const formatStateSummary = (state: Record<string, unknown>): string => {
    if (!state || typeof state !== 'object') {
      return '';
    }

    return Object.entries(state)
      .map(([key, value]) => `${key}: ${formatToastValue(value)}`)
      .join(', ');
  };

  const isToastEnabled = (type: 'state' | 'command') => {
    const currentSettings = frontendSettings ?? DEFAULT_FRONTEND_SETTINGS;
    return type === 'command' ? currentSettings.toast.command : currentSettings.toast.stateChange;
  };

  onMount(() => {
    loadBridgeInfo(true);
    loadFrontendSettings();
    loadActivityLogs();
    checkConsentStatus();
  });

  const checkConsentStatus = async () => {
    try {
      const res = await fetch(`/api/log-sharing/status?_=${Date.now()}`);
      if (res.ok) {
        const status = await res.json();
        if (!status.asked) {
          showConsentModal = true;
        }
      }
    } catch (err) {
      console.error('Failed to check consent status', err);
    }
  };

  // API 요청 helper 함수
  async function apiRequest<T = any>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      // 에러 메시지를 서버에서 받거나 기본 메시지 사용
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // JSON 파싱 실패 시 응답 텍스트 시도
        try {
          const text = await response.text();
          if (text) errorMessage = text;
        } catch {
          // 텍스트 읽기도 실패 시 기본 메시지 사용
        }
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  }

  async function loadBridgeInfo(force = false) {
    if (infoLoading && !force) return;

    infoLoading = true;
    infoError = '';

    try {
      const data = await apiRequest<BridgeInfo>('./api/bridge/info');

      bridgeInfo = data;
      bridgeStatusByPort = new Map();
      rawPackets = [];
      deviceStates.clear();
      packetStatsByPort = new Map();

      const portIds =
        data.bridges?.flatMap((bridge) => bridge.serials.map((serial) => serial.portId)) ?? [];
      const defaultPortId = portIds[0] ?? null;
      if (!selectedPortId || (selectedPortId && !portIds.includes(selectedPortId))) {
        selectedPortId = defaultPortId;
      }

      startMqttStream();
      loadCommands();
      loadPacketHistory();
    } catch (err) {
      bridgeInfo = null;
      closeStream();
      infoError = err instanceof Error ? err.message : '브리지 정보를 불러오지 못했습니다.';
    } finally {
      infoLoading = false;
    }
  }

  async function loadPacketHistory() {
    try {
      const [cmds, parsed] = await Promise.all([
        apiRequest<CommandPacket[]>('./api/packets/command/history'),
        apiRequest<ParsedPacket[]>('./api/packets/parsed/history'),
      ]);
      // portId가 없는 패킷은 그대로 유지 (포트별 필터링 시 처리됨)
      commandPackets = cmds.slice(-MAX_PACKETS);
      parsedPackets = parsed.slice(-MAX_PACKETS);
    } catch (err) {
      console.error('Failed to load packet history:', err);
    }
  }

  async function loadActivityLogs() {
    activityLoading = true;
    activityError = '';
    try {
      const data = await apiRequest<ActivityLog[]>('./api/activity/recent');
      activityLogs = data;
    } catch (err) {
      activityError = err instanceof Error ? err.message : '최근 활동을 불러오지 못했습니다.';
    } finally {
      activityLoading = false;
    }
  }

  async function loadFrontendSettings() {
    settingsLoading = true;
    settingsError = '';
    try {
      const data = await apiRequest<{ settings: FrontendSettings }>('./api/frontend-settings');
      frontendSettings = data.settings;
    } catch (err) {
      settingsError = err instanceof Error ? err.message : '프론트 설정을 불러오지 못했습니다.';
      frontendSettings = DEFAULT_FRONTEND_SETTINGS;
    } finally {
      settingsLoading = false;
    }
  }

  async function persistFrontendSettings(next: FrontendSettings) {
    settingsSaving = true;
    settingsError = '';
    try {
      const data = await apiRequest<{ settings: FrontendSettings }>('./api/frontend-settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: next }),
      });
      frontendSettings = data.settings;
    } catch (err) {
      settingsError = err instanceof Error ? err.message : '프론트 설정을 저장하지 못했습니다.';
      throw err;
    } finally {
      settingsSaving = false;
    }
  }

  async function updateToastSetting(key: 'stateChange' | 'command', value: boolean) {
    const previous = frontendSettings ?? DEFAULT_FRONTEND_SETTINGS;
    const next: FrontendSettings = {
      toast: {
        ...previous.toast,
        [key]: value,
      },
    };
    frontendSettings = next;
    try {
      await persistFrontendSettings(next);
    } catch {
      frontendSettings = previous;
    }
  }

  let socketCloseHandler: (() => void) | null = null;
  let socketErrorHandler: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function startMqttStream() {
    if (typeof window === 'undefined' || !bridgeInfo) return;

    closeStream();

    connectionStatus = 'connecting';
    statusMessage = 'MQTT 스트림을 연결하는 중입니다...';

    // ingress 환경에서는 window.location을 기준으로 해야 Supervisor 토큰이 포함된다
    const baseUrl = typeof window !== 'undefined' ? window.location.href : document.baseURI;
    const url = new URL('./api/packets/stream', baseUrl);
    if (bridgeInfo.mqttUrl.trim().length > 0) {
      url.searchParams.set('mqttUrl', bridgeInfo.mqttUrl.trim());
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    socket = new WebSocket(url.toString());

    const sendStreamCommand = (command: 'start' | 'stop') => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ command }));
      }
    };

    const handleStatus = (data: Record<string, unknown>) => {
      const state = data.state;
      if (state === 'connected') {
        connectionStatus = 'connected';
        statusMessage = 'MQTT 스트림 연결 완료';
      } else if (state === 'subscribed') {
        connectionStatus = 'connected';
        statusMessage = `'${data.topic}' 토픽 구독 중`;
      } else if (state === 'error') {
        connectionStatus = 'error';
        statusMessage =
          typeof data.message === 'string' ? data.message : 'MQTT 스트림 오류가 발생했습니다.';
      } else if (state === 'connecting') {
        connectionStatus = 'connecting';
        statusMessage = 'MQTT 스트림을 다시 연결하는 중입니다...';
      }
    };

    const handleMqttMessage = (data: MqttMessageEvent & { portId?: string }) => {
      const portId = data.portId ?? extractPortIdFromTopic(data.topic);
      if (isBridgeStatusTopic(data.topic) && portId) {
        bridgeStatusByPort.set(portId, data.payload);
        bridgeStatusByPort = new Map(bridgeStatusByPort);
        return;
      }

      if (!isStateTopic(data.topic)) return;
      deviceStates.set(data.topic, { payload: data.payload, portId: portId ?? undefined });
      deviceStates = new Map(deviceStates);
    };

    const handleRawPacketWithInterval = (data: RawPacketWithInterval) => {
      hasIntervalPackets = true;
      const packet = normalizeRawPacket({
        ...data,
        portId: getExplicitPortId(data.portId, data.topic),
      });
      lastRawPacketTimestamp = Date.parse(packet.receivedAt);
      appendRawPacket(packet);
    };

    const handleRawPacketFallback = (data: MqttMessageEvent) => {
      if (hasIntervalPackets) return;
      const timestamp = Date.parse(data.receivedAt);
      const interval = lastRawPacketTimestamp !== null ? timestamp - lastRawPacketTimestamp : null;
      lastRawPacketTimestamp = timestamp;
      appendRawPacket(
        normalizeRawPacket({
          ...data,
          interval,
          portId: getExplicitPortId(undefined, data.topic),
        }),
      );
    };

    const handlePacketStats = (data: PacketStats) => {
      if (data && data.portId) {
        packetStatsByPort.set(data.portId, data);
        packetStatsByPort = new Map(packetStatsByPort);
      }
    };

    const handleCommandPacket = (data: CommandPacket) => {
      // portId가 없는 패킷은 그대로 저장 (필터링 시 제외됨)
      commandPackets = [...commandPackets, data].slice(-MAX_PACKETS);

      if (!isToastEnabled('command')) return;

      const eventTimestamp = new Date(data.timestamp).getTime();
      const now = new Date().getTime();
      if (now - eventTimestamp > 5000) return;

      addToast({
        type: 'command',
        title: `${data.entity || data.entityId} 명령 전송`,
        message:
          data.value !== undefined
            ? `${data.command} → ${formatToastValue(data.value)}`
            : data.command,
        timestamp: data.timestamp,
      });
    };

    const handleParsedPacket = (data: ParsedPacket) => {
      // portId가 없는 패킷은 그대로 저장
      parsedPackets = [...parsedPackets, data].slice(-MAX_PACKETS);
    };

    const handleStateChange = (data: StateChangeEvent) => {
      deviceStates.set(data.topic, {
        payload: data.payload,
        portId: getExplicitPortId(data.portId, data.topic),
      });
      deviceStates = new Map(deviceStates);

      if (!isToastEnabled('state')) return;

      const eventTimestamp = new Date(data.timestamp).getTime();
      const now = new Date().getTime();
      if (now - eventTimestamp > 5000) return;

      const summary = formatStateSummary(data.state);
      addToast({
        type: 'state',
        title: `${extractEntityIdFromTopic(data.topic)} 상태 업데이트`,
        message: summary || data.payload || '상태가 갱신되었습니다.',
        timestamp: data.timestamp,
      });
    };

    const handleActivityLogAdded = (data: ActivityLog) => {
      activityLogs = [...activityLogs, data];
    };

    const messageHandlers: Partial<Record<StreamEvent, (data: any) => void>> = {
      status: handleStatus,
      'mqtt-message': handleMqttMessage,
      'raw-data': handleRawPacketFallback,
      'raw-data-with-interval': handleRawPacketWithInterval,
      'packet-interval-stats': handlePacketStats,
      'command-packet': handleCommandPacket,
      'parsed-packet': handleParsedPacket,
      'state-change': handleStateChange,
      'activity-log-added': handleActivityLogAdded,
    };

    socket.addEventListener('open', () => {
      connectionStatus = 'connected';
      statusMessage = 'MQTT 스트림 연결 완료';
    });

    socket.addEventListener('message', (event) => {
      const message = safeParse<StreamMessage>(event.data);
      if (!message) return;

      const handler = messageHandlers[message.event];
      if (handler) {
        handler(message.data);
      }
    });

    const handleDisconnect = () => {
      connectionStatus = 'connecting';
      statusMessage = '스트림 연결이 끊어졌습니다. 재연결을 시도합니다...';
      socket = null;
      socketCloseHandler = null;
      socketErrorHandler = null;
      isStreaming = false;

      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        startMqttStream();
      }, 3000);
    };

    socketCloseHandler = handleDisconnect;
    socketErrorHandler = handleDisconnect;
    socket.addEventListener('close', handleDisconnect);
    socket.addEventListener('error', handleDisconnect);
  }

  function sendStreamCommand(command: 'start' | 'stop') {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ command }));
    }
  }

  function closeStream() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (socket) {
      if (socketCloseHandler) {
        socket.removeEventListener('close', socketCloseHandler);
      }
      if (socketErrorHandler) {
        socket.removeEventListener('error', socketErrorHandler);
      }
      socket.close();
      socket = null;
      socketCloseHandler = null;
      socketErrorHandler = null;
    }
    connectionStatus = 'idle';
    statusMessage = '';
    packetStatsByPort = new Map();
    hasIntervalPackets = false;
    lastRawPacketTimestamp = null;
  }

  function safeParse<T>(value: string): T | null {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  onDestroy(() => {
    closeStream();
    toastTimeouts.forEach((timeout) => clearTimeout(timeout));
    toastTimeouts.clear();
  });

  async function loadCommands() {
    commandsLoading = true;
    commandsError = '';
    try {
      const data = await apiRequest<{ commands: CommandInfo[] }>('./api/commands');
      availableCommands = data.commands;
      // Initialize inputs with default values
    } catch (err) {
      commandsError = err instanceof Error ? err.message : '명령 목록을 불러오지 못했습니다.';
    } finally {
      commandsLoading = false;
    }
  }

  async function executeCommand(cmd: CommandInfo, value?: any) {
    const key = `${cmd.entityId}_${cmd.commandName}`;
    if (executingCommands.has(key)) return;

    executingCommands.add(key);
    executingCommands = executingCommands; // Trigger reactivity

    try {
      await apiRequest('./api/commands/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityId: cmd.entityId,
          commandName: cmd.commandName,
          value: value,
        }),
      });
    } catch (err) {
      console.error('Command execution failed:', err);
    } finally {
      executingCommands.delete(key);
      executingCommands = executingCommands; // Trigger reactivity
    }
  }

  async function renameEntityRequest(entityId: string, newName: string, portId?: string) {
    const trimmed = newName.trim();
    if (!trimmed) {
      renameError = '새 이름을 입력해주세요.';
      return;
    }

    renameError = '';
    renamingEntityId = entityId;

    try {
      await apiRequest('./api/entities/rename', {
        method: 'POST',
        body: JSON.stringify({ entityId, newName: trimmed, portId }),
      });

      availableCommands = availableCommands.map((cmd) =>
        cmd.entityId === entityId ? { ...cmd, entityName: trimmed } : cmd,
      );
      await loadCommands();

      addToast({
        type: 'state',
        title: '엔티티 이름 변경',
        message: `${trimmed} 으로 이름이 변경되었습니다.`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      renameError = err instanceof Error ? err.message : '이름 변경에 실패했습니다.';
    } finally {
      renamingEntityId = null;
    }
  }

  const portMetadata = $derived.by(() => {
    if (!bridgeInfo?.bridges) return [] as Array<BridgeSerialInfo & { configFile: string }>;
    return bridgeInfo.bridges.flatMap((bridge) =>
      bridge.serials.map((serial) => ({ ...serial, configFile: bridge.configFile })),
    );
  });

  const configPortMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const port of portMetadata) {
      if (port.configFile) {
        map.set(port.configFile, port.portId);
      }
    }
    return map;
  });

  /**
   * `availableCommands`와 `configPortMap`을 기반으로 통합된 엔티티 목록을 생성합니다.
   * 각 엔티티는 고유한 ID, 표시 이름, 타입, 관련 명령 및 포트 ID를 가집니다.
   * 포트 ID는 명령에 명시된 값 또는 `configFile`을 통해 `configPortMap`에서 매핑된 값으로 결정됩니다.
   */
  const unifiedEntities = $derived.by<UnifiedEntity[]>(() => {
    // 복합 키: portId:entityId 형태로 관리하여 같은 entityId가 다른 포트에서 올 때 구분
    const entities = new Map<string, UnifiedEntity>();

    // 복합 키 생성 헬퍼
    const makeKey = (portId: string | undefined, entityId: string) =>
      `${portId ?? 'unknown'}:${entityId}`;

    // 1. Initialize with Commands (Source of Truth for Configured Names)
    for (const cmd of availableCommands) {
      // portId는 명시적으로 제공된 값 또는 configFile에서 매핑된 값만 사용
      const portId =
        cmd.portId ?? (cmd.configFile ? configPortMap.get(cmd.configFile) : null) ?? undefined;

      const key = makeKey(portId, cmd.entityId);

      if (!entities.has(key)) {
        entities.set(key, {
          id: cmd.entityId,
          displayName: cmd.entityName || cmd.entityId,
          type: cmd.entityType,
          commands: [],
          isStatusDevice: false,
          portId,
        });
      }
      const entity = entities.get(key)!;
      entity.commands.push({ ...cmd, portId });
    }

    // 2. Merge States
    for (const [topic, entry] of deviceStates.entries()) {
      if (isBridgeStatusTopic(topic)) continue; // Skip bridge status

      const entityId = extractEntityIdFromTopic(topic);
      const payload = entry?.payload ?? '';
      const portId = entry?.portId;

      const key = makeKey(portId, entityId);

      if (!entities.has(key)) {
        // Unknown entity (read-only or no commands configured)
        entities.set(key, {
          id: entityId,
          displayName: entityId, // Fallback to ID
          commands: [],
          isStatusDevice: false,
          portId,
        });
      }

      const entity = entities.get(key)!;
      entity.statePayload = payload;
    }

    // Convert to array, filter only those with state, and sort
    const allEntities = Array.from(entities.values());
    const filtered = showInactiveEntities
      ? allEntities
      : allEntities.filter((entity) => entity.statePayload);
    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  const entitiesByPort = $derived.by<Record<string, UnifiedEntity[]>>(() => {
    const groups: Record<string, UnifiedEntity[]> = {};
    for (const entity of unifiedEntities) {
      const portId = entity.portId ?? 'unknown';
      if (!groups[portId]) {
        groups[portId] = [];
      }
      groups[portId].push(entity);
    }

    for (const key of Object.keys(groups)) {
      groups[key] = groups[key].sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    return groups;
  });

  const availablePortIds = $derived.by<string[]>(() => getKnownPortIds());

  const activePortId = $derived.by<string | null>(() => {
    if (selectedPortId && availablePortIds.includes(selectedPortId)) return selectedPortId;
    return availablePortIds[0] ?? null;
  });

  $effect(() => {
    if (availablePortIds.length === 0) {
      selectedPortId = null;
      return;
    }

    if (!selectedPortId || !availablePortIds.includes(selectedPortId)) {
      selectedPortId = availablePortIds[0];
    }
  });

  // --- Entity Detail Logic ---

  const selectedEntity = $derived.by<UnifiedEntity | null>(() =>
    selectedEntityId ? unifiedEntities.find((e) => e.id === selectedEntityId) || null : null,
  );

  const selectedEntityParsedPackets = $derived.by<ParsedPacket[]>(() =>
    selectedEntity && parsedPackets
      ? parsedPackets
          .filter(
            (p) =>
              p.entityId === selectedEntityId &&
              (!selectedEntity.portId || !p.portId || p.portId === selectedEntity.portId),
          )
          .slice(-20)
      : [],
  );

  // Command packets ARE structured with entity property but we now have entityId
  const selectedEntityCommandPackets = $derived.by<CommandPacket[]>(() =>
    selectedEntity && commandPackets
      ? commandPackets
          .filter(
            (p) =>
              p.entityId === selectedEntityId &&
              (!selectedEntity.portId || !p.portId || p.portId === selectedEntity.portId),
          )
          .slice(-20)
      : [],
  );

  $effect(() => {
    if (selectedEntityId && !unifiedEntities.some((entity) => entity.id === selectedEntityId)) {
      selectedEntityId = null;
    }
  });

  $effect(() => {
    if (!selectedEntityId) {
      renameError = '';
      renamingEntityId = null;
    }
  });

  const dashboardEntities = $derived.by<UnifiedEntity[]>(() =>
    activePortId ? (entitiesByPort[activePortId] ?? []) : unifiedEntities,
  );

  const filteredCommandPackets = $derived.by<CommandPacket[]>(() =>
    activePortId
      ? commandPackets.filter((packet) => !packet.portId || packet.portId === activePortId)
      : commandPackets,
  );

  const filteredParsedPackets = $derived.by<ParsedPacket[]>(() =>
    activePortId
      ? parsedPackets.filter((packet) => !packet.portId || packet.portId === activePortId)
      : parsedPackets,
  );

  const filteredRawPackets = $derived.by<RawPacketWithInterval[]>(() =>
    activePortId
      ? rawPackets.filter((packet) => !packet.portId || packet.portId === activePortId)
      : rawPackets,
  );

  const filteredPacketStats = $derived.by<PacketStats | null>(() =>
    activePortId ? (packetStatsByPort.get(activePortId) ?? null) : null,
  );

  const filteredActivityLogs = $derived.by<ActivityLog[]>(() =>
    activePortId
      ? activityLogs.filter((log) => !log.portId || log.portId === activePortId)
      : activityLogs,
  );

  const portStatuses = $derived.by(() => {
    const defaultStatus = bridgeInfo?.status ?? 'idle';
    return portMetadata.map((port) => {
      const payload = bridgeStatusByPort.get(port.portId);
      const normalized = ['idle', 'starting', 'started', 'stopped', 'error'].includes(
        (payload || defaultStatus) as string,
      )
        ? ((payload || defaultStatus) as BridgeStatus)
        : 'idle';
      return {
        portId: port.portId,
        status: normalized as BridgeStatus,
        message: payload || undefined,
      };
    });
  });
</script>

<main class="app-container">
  <Header on:toggleSidebar={() => (isSidebarOpen = !isSidebarOpen)} />
  <div class="content-body">
    <Sidebar bind:activeView isOpen={isSidebarOpen} on:close={() => (isSidebarOpen = false)} />

    <section class="main-content">
      {#if activeView === 'dashboard'}
        <Dashboard
          {bridgeInfo}
          {infoLoading}
          {infoError}
          {portMetadata}
          mqttUrl={bridgeInfo?.mqttUrl || ''}
          entities={dashboardEntities}
          selectedPortId={activePortId}
          showInactive={showInactiveEntities}
          activityLogs={filteredActivityLogs}
          {connectionStatus}
          {statusMessage}
          {portStatuses}
          on:select={(e) => (selectedEntityId = e.detail.entityId)}
          on:toggleInactive={() => (showInactiveEntities = !showInactiveEntities)}
          on:portChange={(event) => (selectedPortId = event.detail.portId)}
        />
      {:else if activeView === 'analysis'}
        <Analysis
          stats={filteredPacketStats}
          commandPackets={filteredCommandPackets}
          parsedPackets={filteredParsedPackets}
          rawPackets={filteredRawPackets}
          {isStreaming}
          {portMetadata}
          selectedPortId={activePortId}
          on:portChange={(event) => (selectedPortId = event.detail.portId)}
          on:start={() => {
            sendStreamCommand('start');
            isStreaming = true;
            rawPackets = [];
            packetStatsByPort = new Map();
          }}
          on:stop={() => {
            sendStreamCommand('stop');
            isStreaming = false;
          }}
        />
      {:else if activeView === 'settings'}
        <SettingsView
          {frontendSettings}
          isLoading={settingsLoading}
          error={settingsError}
          isSaving={settingsSaving}
          on:toastChange={(e) => updateToastSetting(e.detail.key, e.detail.value)}
        />
      {/if}
    </section>
  </div>

  {#if selectedEntity}
    <EntityDetail
      entity={selectedEntity}
      isOpen={!!selectedEntityId}
      parsedPackets={selectedEntityParsedPackets}
      commandPackets={selectedEntityCommandPackets}
      on:close={() => (selectedEntityId = null)}
      on:execute={(e) => executeCommand(e.detail.cmd, e.detail.value)}
      isRenaming={renamingEntityId === selectedEntityId}
      {renameError}
      on:rename={(e) =>
        selectedEntity &&
        renameEntityRequest(selectedEntity.id, e.detail.newName, selectedEntity.portId)}
    />
  {/if}
</main>

<ToastContainer {toasts} on:dismiss={(event) => removeToast(event.detail.id)} />

{#if showConsentModal}
  <LogConsentModal onclose={() => (showConsentModal = false)} />
{/if}

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    margin: 0;
    background: #0f172a;
    color: #e2e8f0;
    min-height: 100vh;
  }

  .app-container {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .content-body {
    display: flex;
    flex: 1;
    overflow: hidden; /* Prevent body scrollbars */
  }

  .main-content {
    flex: 1;
    padding: 2rem;
    max-width: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    height: calc(100vh - 65px); /* Header height */
  }

  @media (min-width: 769px) {
    .main-content {
      margin-left: 250px; /* Sidebar width */
      max-width: calc(100% - 250px);
    }
  }

  @media (max-width: 768px) {
    .main-content {
      margin-left: 0;
      padding: 1rem;
      width: 100%;
    }
  }

  /* Scrollbar styling */
  :global(::-webkit-scrollbar) {
    width: 8px;
    height: 8px;
  }

  :global(::-webkit-scrollbar-track) {
    background: rgba(15, 23, 42, 0.5);
  }

  :global(::-webkit-scrollbar-thumb) {
    background: rgba(148, 163, 184, 0.3);
    border-radius: 4px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: rgba(148, 163, 184, 0.5);
  }
</style>
