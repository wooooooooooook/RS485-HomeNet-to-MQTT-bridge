<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { isLoading, locale, t } from 'svelte-i18n';
  import { get } from 'svelte/store';
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
    StatusMessage,
    AutomationSummary,
    ScriptSummary,
    EntityCategory,
  } from './lib/types';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Header from './lib/components/Header.svelte';
  import Dashboard from './lib/views/Dashboard.svelte';
  import Analysis from './lib/views/Analysis.svelte';
  import Gallery from './lib/views/Gallery.svelte';

  import EntityDetail from './lib/components/EntityDetail.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
  import SettingsView from './lib/views/Settings.svelte';

  const MAX_PACKETS = 500000; // ~24 hours at 5 packets/sec

  // -- State --
  let activeView = $state<'dashboard' | 'analysis' | 'gallery' | 'settings'>('dashboard');
  // Entity selection uses a composite key: "category:portId:entityId" to distinguish entities across ports
  let selectedEntityKey = $state<string | null>(null);
  let isSidebarOpen = $state(false);
  let showInactiveEntities = $state(false);

  // Helper to create/parse entity composite keys
  const makeEntityKey = (
    portId: string | undefined,
    entityId: string,
    category: EntityCategory = 'entity',
  ) => `${category}:${portId ?? 'unknown'}:${entityId}`;
  const parseEntityKey = (
    key: string,
  ): { portId: string | undefined; entityId: string; category: EntityCategory } => {
    const parts = key.split(':');
    if (parts.length < 3) {
      const idx = key.indexOf(':');
      if (idx === -1) return { portId: undefined, entityId: key, category: 'entity' };
      const portId = key.slice(0, idx);
      return {
        portId: portId === 'unknown' ? undefined : portId,
        entityId: key.slice(idx + 1),
        category: 'entity',
      };
    }
    const [category, portId, ...rest] = parts;
    return {
      category: (category as EntityCategory) ?? 'entity',
      portId: portId === 'unknown' ? undefined : portId,
      entityId: rest.join(':'),
    };
  };

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
  let statusMessage = $state<StatusMessage | null>(null);
  let isStreaming = $state(false);

  // Command buttons state
  let availableCommands = $state<CommandInfo[]>([]);
  let commandsLoading = $state(false);
  let commandsError = $state('');
  let automationItems = $state<AutomationSummary[]>([]);
  let scriptItems = $state<ScriptSummary[]>([]);
  // Generic input state map for various input types

  let executingCommands = $state(new Set<string>());

  let rawPackets = $state<RawPacketWithInterval[]>([]);
  let parsedPackets = $state<ParsedPacket[]>([]);
  let packetStatsByPort = $state(new Map<string, PacketStats>());
  let hasIntervalPackets = $state(false);
  let lastRawPacketTimestamp = $state<number | null>(null);
  let validRawPacketsOnly = $state(false);
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

  let isRecording = $state(false);
  let recordingStartTime = $state<number | null>(null);
  let recordedFile = $state<{ filename: string; path: string } | null>(null);
  type RawPacketStreamMode = 'all' | 'valid';
  const rawPacketStreamMode = $derived.by<RawPacketStreamMode>(() =>
    validRawPacketsOnly ? 'valid' : 'all',
  );
  let lastAppliedRawPacketMode = $state<RawPacketStreamMode>('all');

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
    payload: data.payload ?? '',
    receivedAt: data.receivedAt ?? new Date().toISOString(),
    interval: typeof data.interval === 'number' ? data.interval : null,
    portId: getExplicitPortId(data.portId),
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
    checkRecordingStatus();
  });

  async function checkRecordingStatus() {
    try {
      const data = await apiRequest<{
        isLogging: boolean;
        startTime: number | null;
        packetCount: number;
        filename: string | null;
      }>('./api/logs/packet/status');
      isRecording = data.isLogging;
      recordingStartTime = data.startTime;
      // Note: We don't necessarily need to sync packetCount if we are streaming everything
    } catch (e) {
      console.error('Failed to check recording status:', e);
    }
  }

  // Analysis 페이지 진입/이탈 시 자동으로 스트리밍 시작/중지
  $effect(() => {
    // connectionStatus와 activeView를 의존성으로 사용하여 reactive하게 동작
    if (connectionStatus !== 'connected') return;

    if (activeView === 'analysis' || isRecording) {
      // 스트리밍 시작 & 데이터 초기화 (처음 들어올 때만)
      if (!isStreaming) {
        sendStreamCommand('start', rawPacketStreamMode);
        lastAppliedRawPacketMode = rawPacketStreamMode;
        isStreaming = true;
      }
      if (activeView === 'analysis' && rawPackets.length === 0 && !isRecording) {
        // Analysis에 처음 들어왔고 녹화중이 아닐 때만 초기화
        packetStatsByPort = new Map();
      }
    } else {
      // Analysis가 아니고 녹화중도 아닐 때 스트리밍 중지
      if (isStreaming && !isRecording) {
        sendStreamCommand('stop');
        isStreaming = false;
      }
    }
  });

  $effect(() => {
    if (!isStreaming || connectionStatus !== 'connected') return;
    if (rawPacketStreamMode === lastAppliedRawPacketMode) return;
    lastAppliedRawPacketMode = rawPacketStreamMode;
    rawPackets = [];
    packetStatsByPort = new Map();
    hasIntervalPackets = false;
    lastRawPacketTimestamp = null;
    sendStreamCommand('start', rawPacketStreamMode);
  });

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

  function handleRawRecordingStart() {
    rawPackets = [];
    packetStatsByPort = new Map();
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
      loadAutomations();
      loadScripts();
      loadPacketHistory();
    } catch (err) {
      bridgeInfo = null;
      closeStream();
      // 서버에서 오는 에러가 에러 키 형태면 그대로 사용, 아니면 기본 에러 키 사용
      const errorMessage = err instanceof Error ? err.message : 'BRIDGE_INFO_LOAD_FAILED';
      // 에러 키 형태인지 확인 (대문자와 언더스코어로 구성)
      infoError = /^[A-Z_]+$/.test(errorMessage) ? errorMessage : 'BRIDGE_INFO_LOAD_FAILED';
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
      activityError = err instanceof Error ? err.message : get(t)('errors.ACTIVITY_LOAD_FAILED');
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
      if (frontendSettings.locale) {
        locale.set(frontendSettings.locale);
      }
    } catch (err) {
      settingsError = err instanceof Error ? err.message : get(t)('errors.SETTINGS_LOAD_FAILED');
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
      settingsError = err instanceof Error ? err.message : get(t)('errors.SETTINGS_SAVE_FAILED');
      throw err;
    } finally {
      settingsSaving = false;
    }
  }

  async function updateToastSetting(key: 'stateChange' | 'command', value: boolean) {
    const previous = frontendSettings ?? DEFAULT_FRONTEND_SETTINGS;
    const next: FrontendSettings = {
      ...previous,
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

  async function updateLocaleSetting(newLocale: string) {
    const previous = frontendSettings ?? DEFAULT_FRONTEND_SETTINGS;
    const next: FrontendSettings = {
      ...previous,
      locale: newLocale,
    };
    frontendSettings = next;
    locale.set(newLocale);
    try {
      await persistFrontendSettings(next);
    } catch {
      frontendSettings = previous;
      if (previous.locale) {
        locale.set(previous.locale);
      }
    }
  }

  let socketCloseHandler: (() => void) | null = null;
  let socketErrorHandler: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function startMqttStream() {
    if (typeof window === 'undefined' || !bridgeInfo) return;

    closeStream();

    connectionStatus = 'connecting';
    statusMessage = { key: 'mqtt.connecting' };

    // ingress 환경에서는 window.location을 기준으로 해야 Supervisor 토큰이 포함된다
    const baseUrl = typeof window !== 'undefined' ? window.location.href : document.baseURI;
    const url = new URL('./api/packets/stream', baseUrl);
    if (bridgeInfo.mqttUrl.trim().length > 0) {
      url.searchParams.set('mqttUrl', bridgeInfo.mqttUrl.trim());
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    socket = new WebSocket(url.toString());

    const handleStatus = (data: Record<string, unknown>) => {
      const state = data.state;
      if (state === 'connected') {
        connectionStatus = 'connected';
        statusMessage = { key: 'mqtt.connected' };
      } else if (state === 'subscribed') {
        connectionStatus = 'connected';
        statusMessage = { key: 'mqtt.subscribed', values: { topic: data.topic } };
      } else if (state === 'error') {
        connectionStatus = 'error';
        // Error messages from server might be raw strings.
        statusMessage = {
          key: typeof data.message === 'string' ? data.message : 'mqtt.error',
        };
      } else if (state === 'connecting') {
        connectionStatus = 'connecting';
        statusMessage = { key: 'mqtt.connecting' };
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
        portId: getExplicitPortId(data.portId),
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
          portId: getExplicitPortId(undefined),
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
        title: get(t)('toasts.command_sent', { values: { entity: data.entity || data.entityId } }),
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
        title: get(t)('toasts.state_update', {
          values: { entity: extractEntityIdFromTopic(data.topic) },
        }),
        message: summary || data.payload || get(t)('toasts.state_updated'),
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
      statusMessage = { key: 'mqtt.connected' };
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
      statusMessage = { key: 'mqtt.disconnected' };
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

  function sendStreamCommand(command: 'start' | 'stop', mode?: RawPacketStreamMode) {
    if (socket?.readyState === WebSocket.OPEN) {
      const payload: { command: 'start' | 'stop'; mode?: RawPacketStreamMode } = { command };
      if (command === 'start') {
        payload.mode = mode ?? rawPacketStreamMode;
      }
      socket.send(JSON.stringify(payload));
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
    statusMessage = null;
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
      commandsError = err instanceof Error ? err.message : get(t)('errors.COMMANDS_LOAD_FAILED');
    } finally {
      commandsLoading = false;
    }
  }

  async function loadAutomations() {
    try {
      const data = await apiRequest<{ automations: AutomationSummary[] }>('./api/automations');
      automationItems = data.automations ?? [];
    } catch (err) {
      console.error('Failed to load automations:', err);
      automationItems = [];
    }
  }

  async function loadScripts() {
    try {
      const data = await apiRequest<{ scripts: ScriptSummary[] }>('./api/scripts');
      scriptItems = data.scripts ?? [];
    } catch (err) {
      console.error('Failed to load scripts:', err);
      scriptItems = [];
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
      renameError = get(t)('errors.RENAME_EMPTY_NAME');
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
        title: get(t)('toasts.entity_renamed_title'),
        message: get(t)('toasts.entity_renamed_message', { values: { name: trimmed } }),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      renameError = err instanceof Error ? err.message : get(t)('errors.RENAME_FAILED');
    } finally {
      renamingEntityId = null;
    }
  }

  const portMetadata = $derived.by(() => {
    if (!bridgeInfo?.bridges)
      return [] as Array<
        BridgeSerialInfo & {
          configFile: string;
          error?: string;
          status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
        }
      >;
    return bridgeInfo.bridges.flatMap((bridge) => {
      if (bridge.serials.length === 0 && (bridge.error || bridge.status === 'error')) {
        // Serials가 없지만 에러가 있는 경우, placeholder 포트를 추가하여 UI 탭에 표시되도록 함
        return [
          {
            portId: bridge.configFile, // 파일명을 ID로 사용
            path: '',
            baudRate: 0,
            topic: '',
            configFile: bridge.configFile,
            error: bridge.error,
            status: bridge.status,
          },
        ];
      }
      return bridge.serials.map((serial) => ({
        ...serial,
        configFile: bridge.configFile,
        error: bridge.error,
        status: bridge.status,
      }));
    });
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
  const allUnifiedEntities = $derived.by<UnifiedEntity[]>(() => {
    // 복합 키: portId:entityId 형태로 관리하여 같은 entityId가 다른 포트에서 올 때 구분
    const entities = new Map<string, UnifiedEntity>();

    // 복합 키 생성 헬퍼
    const makeKey = (
      portId: string | undefined,
      entityId: string,
      category: EntityCategory = 'entity',
    ) => `${category}:${portId ?? 'unknown'}:${entityId}`;

    // 1. Initialize with Commands (Source of Truth for Configured Names)
    for (const cmd of availableCommands) {
      // portId는 명시적으로 제공된 값 또는 configFile에서 매핑된 값만 사용
      const portId =
        cmd.portId ?? (cmd.configFile ? configPortMap.get(cmd.configFile) : null) ?? undefined;

      const key = makeKey(portId, cmd.entityId, 'entity');

      if (!entities.has(key)) {
        entities.set(key, {
          id: cmd.entityId,
          displayName: cmd.entityName || cmd.entityId,
          type: cmd.entityType,
          category: 'entity',
          commands: [],
          isStatusDevice: false,
          portId,
          discoveryAlways: cmd.discoveryAlways,
          discoveryLinkedId: cmd.discoveryLinkedId,
        });
      }
      const entity = entities.get(key)!;
      entity.commands.push({ ...cmd, portId });
      // Merge discovery flags if present on any command (though they should be consistent per entity)
      if (cmd.discoveryAlways) entity.discoveryAlways = true;
      if (cmd.discoveryLinkedId) entity.discoveryLinkedId = cmd.discoveryLinkedId;
    }

    // 2. Merge States
    for (const [topic, entry] of deviceStates.entries()) {
      if (isBridgeStatusTopic(topic)) continue; // Skip bridge status

      const entityId = extractEntityIdFromTopic(topic);
      const payload = entry?.payload ?? '';
      const portId = entry?.portId;

      const key = makeKey(portId, entityId, 'entity');

      if (!entities.has(key)) {
        // Unknown entity (read-only or no commands configured)
        entities.set(key, {
          id: entityId,
          displayName: entityId, // Fallback to ID
          category: 'entity',
          commands: [],
          isStatusDevice: false,
          portId,
        });
      }

      const entity = entities.get(key)!;
      entity.statePayload = payload;
    }

    for (const automation of automationItems) {
      const portId =
        automation.portId ??
        (automation.configFile ? configPortMap.get(automation.configFile) : null) ??
        undefined;
      const key = makeKey(portId, automation.id, 'automation');
      if (!entities.has(key)) {
        entities.set(key, {
          id: automation.id,
          displayName: automation.name || automation.id,
          category: 'automation',
          description: automation.description,
          enabled: automation.enabled,
          commands: [],
          isStatusDevice: false,
          portId,
        });
      }
    }

    for (const script of scriptItems) {
      const portId = (script.configFile ? configPortMap.get(script.configFile) : null) ?? undefined;
      const key = makeKey(portId, script.id, 'script');
      if (!entities.has(key)) {
        entities.set(key, {
          id: script.id,
          displayName: script.id,
          category: 'script',
          description: script.description,
          commands: [],
          isStatusDevice: false,
          portId,
        });
      }
    }

    // Calculate isActive for all entities
    for (const entity of entities.values()) {
      if (entity.category === 'automation') {
        entity.isActive = entity.enabled !== false;
        continue;
      }
      if (entity.category === 'script') {
        entity.isActive = true;
        continue;
      }

      let isActive = false;
      if (entity.statePayload) {
        isActive = true;
      } else if (entity.discoveryAlways) {
        isActive = true;
      } else if (entity.discoveryLinkedId) {
        // Check if the linked entity has state
        const linkedKey = makeKey(entity.portId, entity.discoveryLinkedId, 'entity');
        const linkedEntity = entities.get(linkedKey);
        if (linkedEntity && linkedEntity.statePayload) {
          isActive = true;
        }
      }
      entity.isActive = isActive;
    }

    return Array.from(entities.values());
  });

  const unifiedEntities = $derived.by<UnifiedEntity[]>(() => {
    const filtered = showInactiveEntities
      ? allUnifiedEntities
      : allUnifiedEntities.filter((entity) => entity.isActive);
    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  const hasInactiveEntities = $derived.by<boolean>(() => {
    if (!activePortId) return false;
    return allUnifiedEntities.some((e) => (!e.portId || e.portId === activePortId) && !e.isActive);
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

  const selectedEntity = $derived.by<UnifiedEntity | null>(() => {
    if (!selectedEntityKey) return null;
    const { portId, entityId, category } = parseEntityKey(selectedEntityKey);
    return (
      unifiedEntities.find(
        (e) => e.id === entityId && e.portId === portId && e.category === category,
      ) || null
    );
  });

  const selectedEntityParsedPackets = $derived.by<ParsedPacket[]>(() =>
    selectedEntity && parsedPackets && selectedEntity.category === 'entity'
      ? parsedPackets
          .filter(
            (p) =>
              p.entityId === selectedEntity.id &&
              (!selectedEntity.portId || !p.portId || p.portId === selectedEntity.portId),
          )
          .slice(-20)
      : [],
  );

  // Command packets ARE structured with entity property but we now have entityId
  const selectedEntityCommandPackets = $derived.by<CommandPacket[]>(() =>
    selectedEntity && commandPackets && selectedEntity.category === 'entity'
      ? commandPackets
          .filter(
            (p) =>
              p.entityId === selectedEntity.id &&
              (!selectedEntity.portId || !p.portId || p.portId === selectedEntity.portId),
          )
          .slice(-20)
      : [],
  );

  const selectedEntityActivityLogs = $derived.by<ActivityLog[]>(() => {
    if (!selectedEntity) return [];
    if (selectedEntity.category === 'automation') {
      return activityLogs.filter(
        (log) =>
          log.code.startsWith('log.automation_') && log.params?.automationId === selectedEntity.id,
      );
    }
    if (selectedEntity.category === 'script') {
      return activityLogs.filter(
        (log) => log.code.startsWith('log.script_') && log.params?.scriptId === selectedEntity.id,
      );
    }
    return [];
  });

  $effect(() => {
    if (selectedEntityKey) {
      const { portId, entityId, category } = parseEntityKey(selectedEntityKey);
      const exists = unifiedEntities.some(
        (entity) =>
          entity.id === entityId && entity.portId === portId && entity.category === category,
      );
      if (!exists) {
        selectedEntityKey = null;
      }
    }
  });

  $effect(() => {
    if (!selectedEntityKey) {
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

  const filteredAutomationScriptLogs = $derived.by<ActivityLog[]>(() =>
    filteredActivityLogs.filter(
      (log) => log.code.startsWith('log.automation_') || log.code.startsWith('log.script_'),
    ),
  );

  const portStatuses = $derived.by(() => {
    const defaultStatus = bridgeInfo?.status ?? 'idle';
    return portMetadata.map((port) => {
      // 1. If explicit startup error (from config loading/connect failure)
      if (port.error) {
        return {
          portId: port.portId,
          status: 'error' as BridgeStatus,
          message: port.error,
        };
      }

      // 2. If the bridge reports a specific status (e.g. 'starting', 'error') via API
      if (port.status && port.status !== 'idle' && port.status !== 'started') {
        return {
          portId: port.portId,
          status: port.status as BridgeStatus,
          message: undefined,
        };
      }

      // 3. Fallback to MQTT status if bridge claims to be 'started' or 'idle'
      // If port.status is 'started', we trust it unless MQTT says otherwise (e.g. last will 'offline')
      const mqttStatus = bridgeStatusByPort.get(port.portId);
      const normalizedMqttStatus = ['idle', 'starting', 'started', 'stopped', 'error'].includes(
        (mqttStatus || '') as string,
      )
        ? (mqttStatus as BridgeStatus)
        : null;

      // If we have an MQTT status, use it. Otherwise, use the API status (which might be 'started')
      const finalStatus = normalizedMqttStatus || (port.status as BridgeStatus) || defaultStatus;

      return {
        portId: port.portId,
        status: finalStatus,
        message: mqttStatus || undefined,
      };
    });
  });
</script>

{#if $isLoading}
  <div class="loading-screen">Loading resources...</div>
{:else}
  <a href="#main-content" class="skip-link">{$t('header.skip_to_content')}</a>
  <main class="app-container">
    <Header onToggleSidebar={() => (isSidebarOpen = !isSidebarOpen)} />
    <div class="content-body">
      <Sidebar bind:activeView isOpen={isSidebarOpen} onClose={() => (isSidebarOpen = false)} />

      <section id="main-content" class="main-content" tabindex="-1">
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
            {hasInactiveEntities}
            activityLogs={filteredActivityLogs}
            {connectionStatus}
            {statusMessage}
            {portStatuses}
            onSelect={(entityId, portId, category) =>
              (selectedEntityKey = makeEntityKey(portId, entityId, category))}
            onToggleInactive={() => (showInactiveEntities = !showInactiveEntities)}
            onPortChange={(portId) => (selectedPortId = portId)}
          />
        {:else if activeView === 'analysis'}
          <Analysis
            stats={filteredPacketStats}
            commandPackets={filteredCommandPackets}
            parsedPackets={filteredParsedPackets}
            rawPackets={filteredRawPackets}
            {isStreaming}
            {portMetadata}
            activityLogs={filteredAutomationScriptLogs}
            selectedPortId={activePortId}
            onPortChange={(portId) => (selectedPortId = portId)}
            onStart={handleRawRecordingStart}
            bind:validOnly={validRawPacketsOnly}
            bind:isRecording
            bind:recordingStartTime
            bind:recordedFile
          />
        {:else if activeView === 'gallery'}
          <Gallery {bridgeInfo} />
        {:else if activeView === 'settings'}
          <SettingsView
            {frontendSettings}
            isLoading={settingsLoading}
            error={settingsError}
            isSaving={settingsSaving}
            onToastChange={(key, value) => updateToastSetting(key, value)}
            onLocaleChange={(value) => updateLocaleSetting(value)}
          />
        {/if}
      </section>
    </div>

    {#if selectedEntity}
      <EntityDetail
        entity={selectedEntity}
        isOpen={!!selectedEntityKey}
        parsedPackets={selectedEntityParsedPackets}
        commandPackets={selectedEntityCommandPackets}
        activityLogs={selectedEntityActivityLogs}
        onClose={() => (selectedEntityKey = null)}
        onExecute={(cmd, value) => executeCommand(cmd, value)}
        isRenaming={renamingEntityId === selectedEntity.id}
        {renameError}
        onRename={(newName) =>
          selectedEntity && renameEntityRequest(selectedEntity.id, newName, selectedEntity.portId)}
      />
    {/if}
  </main>
{/if}

<ToastContainer {toasts} onDismiss={(id) => removeToast(id)} />

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
      padding: 0.75rem;
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

  .loading-screen {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    color: #94a3b8;
  }

  .skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: #3b82f6;
    color: white;
    padding: 8px;
    z-index: 100;
    transition: top 0.2s;
    text-decoration: none;
    font-weight: 500;
    border-radius: 0 0 4px 0;
  }

  .skip-link:focus {
    top: 0;
  }
</style>
