<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { isLoading, locale, t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import './lib/i18n';
  import type {
    BridgeInfo,
    BridgeErrorPayload,
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
    PacketLogEntry,
    CommandLogEntry,
    PacketHistoryResponse,
    ConfigEntitySummary,
    EntityErrorEvent,
  } from './lib/types';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Header from './lib/components/Header.svelte';
  import Dashboard from './lib/views/Dashboard.svelte';
  import Analysis from './lib/views/Analysis.svelte';
  import Gallery from './lib/views/Gallery.svelte';

  import EntityDetail from './lib/components/EntityDetail.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
  import SetupWizard from './lib/components/SetupWizard.svelte';
  import SettingsView from './lib/views/Settings.svelte';
  import { getTimeZone, setTimeZone, withTimeZone } from './lib/utils/time';

  const MAX_PACKETS = 500000; // ~24 hours at 5 packets/sec
  const DASHBOARD_INACTIVE_KEY = 'dashboard.showInactiveEntities';
  const DASHBOARD_ENTITY_KEY = 'dashboard.showEntities';
  const DASHBOARD_AUTOMATION_KEY = 'dashboard.showAutomations';
  const DASHBOARD_SCRIPT_KEY = 'dashboard.showScripts';
  const LOG_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  };
  let cachedLogLocale = '';
  let cachedLogTimeZone: string | undefined;
  let logTimeFormatter = new Intl.DateTimeFormat('en-US', withTimeZone(LOG_TIME_FORMAT_OPTIONS));

  const getLogTimeFormatter = () => {
    const currentLocale = get(locale) === 'ko' ? 'ko-KR' : 'en-US';
    const currentTimeZone = getTimeZone();
    if (currentLocale !== cachedLogLocale || currentTimeZone !== cachedLogTimeZone) {
      cachedLogLocale = currentLocale;
      cachedLogTimeZone = currentTimeZone;
      logTimeFormatter = new Intl.DateTimeFormat(
        currentLocale,
        withTimeZone(LOG_TIME_FORMAT_OPTIONS),
      );
    }
    return logTimeFormatter;
  };

  const formatLogTime = (timestamp: string) => getLogTimeFormatter().format(new Date(timestamp));

  const safeStringify = (value: unknown) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  };

  const resolveBridgeErrorMessage = (
    error?: BridgeErrorPayload | string | null,
  ): string | undefined => {
    if (!error) return undefined;
    if (typeof error === 'string') {
      return get(t)(`errors.${error}`, { default: error });
    }
    return get(t)(`errors.${error.code}`, {
      default: error.message || error.detail || error.code,
    });
  };

  const normalizeSearchText = (...parts: Array<string | undefined>) =>
    parts.filter(Boolean).join(' ').toLowerCase();

  const buildCommandSearchText = (
    entry: { entityId: string; command: string; value?: unknown },
    packet: string,
  ) =>
    normalizeSearchText(
      entry.entityId,
      packet,
      entry.command,
      entry.value !== undefined ? safeStringify(entry.value) : '',
    );

  const buildParsedSearchText = (entry: { entityId: string; state: unknown }, packet: string) =>
    normalizeSearchText(entry.entityId, packet, entry.state ? safeStringify(entry.state) : '');

  const parseTimestampMs = (timestamp: string) => {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const enrichCommandLogEntry = (entry: CommandLogEntry, packet: string): CommandLogEntry => {
    const timestampMs = entry.timestampMs ?? parseTimestampMs(entry.timestamp);
    const timeLabel = entry.timeLabel ?? formatLogTime(entry.timestamp);
    const searchText = entry.searchText ?? buildCommandSearchText(entry, packet);
    return { ...entry, timestampMs, timeLabel, searchText };
  };

  const enrichParsedLogEntry = (entry: PacketLogEntry, packet: string): PacketLogEntry => {
    const timestampMs = entry.timestampMs ?? parseTimestampMs(entry.timestamp);
    const timeLabel = entry.timeLabel ?? formatLogTime(entry.timestamp);
    const searchText = entry.searchText ?? buildParsedSearchText(entry, packet);
    return { ...entry, timestampMs, timeLabel, searchText };
  };

  // Optimized insertion that mutates the array in-place to avoid O(N) copy on every packet
  // Svelte 5 fine-grained reactivity handles array mutation efficiently.
  const insertSortedLogEntry = <T extends { timestamp: string; timestampMs?: number }>(
    logs: T[],
    entry: T,
  ) => {
    const entryTimestamp = entry.timestampMs ?? parseTimestampMs(entry.timestamp);

    // Optimization: If the new entry is newer than the last entry, just push (common case)
    if (
      logs.length === 0 ||
      (logs[0].timestampMs ?? parseTimestampMs(logs[0].timestamp)) < entryTimestamp
    ) {
      // Since we sort descending (newest first) in the UI usually?
      // Wait, the previous code was binary searching.
      // Let's check the sort order.
      // The display logic in App.svelte seemed to use .sort((a,b) => b-a) for history,
      // but insertSortedLogEntry seems to maintain existing order.
      // Let's assume we want to maintain time order.
      // PacketLog expects chronological order or reverse?
      // mergePackets logic:
      // while (rxIndex < rxLen || txIndex < txLen)
      // if ( ... rxTimestamp >= txTimestamp )
      // It seems to expect sorted arrays.
      // If sorting is ascending or descending?
      // mergePackets: checks rxTimestamp >= txTimestamp.
      // If arrays are DESCENDING (newest first):
      // rx[0] is newest. tx[0] is newest.
      // if rx >= tx, take rx. This produces a merged DESCENDING list.
      // So we need to maintain DESCENDING order in the logs.

      // Let's check the previous sort in loadPacketHistory:
      // .sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
      // So yes, DESCENDING (newest at index 0).

      // If Newest (Largest TS) -> Index 0.
      // If entry > logs[0], unshift?
      // Unshift is O(N).
      // If we keep arrays generic, O(N) unshift is unavoidable for array.
      // BUT, Svelte 5 proxies might optimize or we can use a ring buffer?
      // No, standard array unshift is O(N).
      // However, existing `insertSortedLogEntry` was doing `[...logs]` which is O(N) copy, THEN splice.
      // In-place `unshift` is still O(N) shift, but avoids the allocation/GC overhead of copying the whole array.
      // Also `push` is O(1).

      // Maybe we should store logs in ASCENDING order (push to end O(1)), and iterate backwards or reverse in UI?
      // PacketLog `mergePackets` iterates 0..N.
      // If we change storage order, we break `mergePackets`.
      // Let's stick to in-place mutation first.

      /* 
           Wait, binary search logic was:
           midTimestamp >= entryTimestamp -> left = mid + 1
           Else -> right = mid
           
           If logs[mid] (element) > entry (new), we go RIGHT (index increases).
           So larger timestamps are at LOWER indices.
           So it IS Descending. (Newest at 0).
           
           So we usually insert at 0. `unshift`.
        */

      // Fast path for newest packet
      if (
        logs.length === 0 ||
        entryTimestamp >= (logs[0].timestampMs ?? parseTimestampMs(logs[0].timestamp))
      ) {
        logs.unshift(entry);
      } else {
        // Binary search for insertion point
        let left = 0;
        let right = logs.length;

        while (left < right) {
          const mid = (left + right) >> 1;
          const midTimestamp = logs[mid].timestampMs ?? parseTimestampMs(logs[mid].timestamp);
          if (midTimestamp >= entryTimestamp) {
            left = mid + 1;
          } else {
            right = mid;
          }
        }
        logs.splice(left, 0, entry);
      }

      if (logs.length > MAX_PACKETS) {
        logs.length = MAX_PACKETS;
      }
    } else {
      // Fallback or logic check?
      // Re-implementing the whole binary search logic in-place.
      let left = 0;
      let right = logs.length;

      while (left < right) {
        const mid = (left + right) >> 1;
        const midTimestamp = logs[mid].timestampMs ?? parseTimestampMs(logs[mid].timestamp);
        if (midTimestamp >= entryTimestamp) {
          left = mid + 1; // Element is newer, go right to find older place
        } else {
          right = mid;
        }
      }
      logs.splice(left, 0, entry);

      if (logs.length > MAX_PACKETS) {
        logs.length = MAX_PACKETS;
      }
    }
  };

  // -- State --
  let activeView = $state<'dashboard' | 'analysis' | 'gallery' | 'settings'>('dashboard');
  // Entity selection uses a composite key: "category:portId:entityId" to distinguish entities across ports
  let selectedEntityKey = $state<string | null>(null);
  let isSidebarOpen = $state(false);
  let showInactiveEntities = $state(false);
  let showEntityCards = $state(true);
  let showAutomationCards = $state(true);
  let showScriptCards = $state(true);

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

  // Packet dictionary cache (packetId -> hex string)
  let packetDictionary = $state<Record<string, string>>({});
  // Raw logs with packetId (optimized storage)
  // OPTIMIZATION: Use native arrays instead of $state to avoid Deep Proxy overhead.
  let commandPacketLogs: CommandLogEntry[] = [];
  let parsedPacketLogs: PacketLogEntry[] = [];
  let logVersion = $state(0);

  // Buffers for batch processing
  let commandLogBuffer: CommandLogEntry[] = [];
  let parsedLogBuffer: PacketLogEntry[] = [];
  const LOG_FLUSH_INTERVAL = 250;
  let logFlushTimer: ReturnType<typeof setInterval> | undefined;

  type DeviceStateEntry = { payload: string; portId?: string };
  type ParsedStateEntry = { entityId: string; state: Record<string, unknown>; portId?: string };
  type AnalyzerStateOption = {
    id: string;
    label: string;
    state: Record<string, unknown>;
    portId?: string;
  };
  let deviceStates = $state(new Map<string, DeviceStateEntry>());
  let parsedStates = $state(new Map<string, ParsedStateEntry>());
  let socket = $state<WebSocket | null>(null);
  let isSocketOpen = $state(false); // WebSocket 연결 상태 (UI-서버 간 실시간 통신용)
  let mqttConnectionStatus = $state<'idle' | 'connecting' | 'connected' | 'error'>('idle'); // MQTT 브로커 연결 상태
  let statusMessage = $state<StatusMessage | null>(null);
  let isStreaming = $state(false);

  // Command buttons state
  let availableCommands = $state<CommandInfo[]>([]);
  let configuredEntities = $state<ConfigEntitySummary[]>([]);
  let commandsLoading = $state(false);
  let commandsError = $state('');
  let automationItems = $state<AutomationSummary[]>([]);
  let scriptItems = $state<ScriptSummary[]>([]);
  // Generic input state map for various input types

  let executingCommands = $state(new Set<string>());

  // OPTIMIZATION: Use native arrays for raw packets too
  let rawPackets: RawPacketWithInterval[] = []; // Changed from $state

  let packetStatsByPort = $state(new Map<string, PacketStats>());
  let hasIntervalPackets = $state(false);
  let lastRawPacketTimestamp = $state<number | null>(null);
  let validRawPacketsOnly = $state(true);
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
    activityLog: {
      hideAutomationScripts: false,
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
  let entityErrorsByKey = $state<Map<string, EntityErrorEvent[]>>(new Map());
  const MAX_ENTITY_ERRORS = 50;

  let isRecording = $state(false);
  let recordingStartTime = $state<number | null>(null);
  let recordedFile = $state<{ filename: string; path: string } | null>(null);
  let showAddBridgeModal = $state(false);
  type RawPacketStreamMode = 'all' | 'valid';
  const rawPacketStreamMode = $derived.by<RawPacketStreamMode>(() =>
    validRawPacketsOnly ? 'valid' : 'all',
  );
  let lastAppliedRawPacketMode = $state<RawPacketStreamMode>('valid');

  type StreamEvent =
    | 'status'
    | 'mqtt-message'
    | 'raw-data'
    | 'raw-data-with-interval'
    | 'packet-interval-stats'
    | 'command-packet'
    | 'parsed-packet'
    | 'state-change'
    | 'activity-log-added'
    | 'entity-error';

  type StreamMessage<T = unknown> = {
    event: StreamEvent;
    data: T;
  };

  const normalizeTopicParts = (topic: string) => topic.split('/').filter(Boolean);
  const getBasePrefixParts = () =>
    normalizeTopicParts(bridgeInfo?.bridges?.[0]?.mqttTopicPrefix ?? '');

  const getKnownPortIds = () =>
    bridgeInfo?.bridges?.reduce<string[]>(
      (acc, bridge) => (bridge.serial ? acc.concat(bridge.serial.portId) : acc),
      [],
    ) ?? [];
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

    return parts.length > 0 ? parts[parts.length - 1] : topic;
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
    direction: data.direction, // TX/RX 방향 정보 전달
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

  function persistDashboardFilterVisibility(
    entitiesEnabled: boolean,
    automationsEnabled: boolean,
    scriptsEnabled: boolean,
  ) {
    if (typeof window === 'undefined') return;
    const hasAny = entitiesEnabled || automationsEnabled || scriptsEnabled;
    window.localStorage.setItem(DASHBOARD_ENTITY_KEY, String(hasAny ? entitiesEnabled : true));
    window.localStorage.setItem(DASHBOARD_AUTOMATION_KEY, String(automationsEnabled));
    window.localStorage.setItem(DASHBOARD_SCRIPT_KEY, String(scriptsEnabled));
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      const storedInactive = window.localStorage.getItem(DASHBOARD_INACTIVE_KEY);
      if (storedInactive !== null) {
        showInactiveEntities = storedInactive === 'true';
      }
      const storedEntity = window.localStorage.getItem(DASHBOARD_ENTITY_KEY);
      if (storedEntity !== null) {
        showEntityCards = storedEntity !== 'false';
      }
      const storedAutomation = window.localStorage.getItem(DASHBOARD_AUTOMATION_KEY);
      if (storedAutomation !== null) {
        showAutomationCards = storedAutomation !== 'false';
      }
      const storedScript = window.localStorage.getItem(DASHBOARD_SCRIPT_KEY);
      if (storedScript !== null) {
        showScriptCards = storedScript !== 'false';
      }
      if (!showEntityCards && !showAutomationCards && !showScriptCards) {
        showEntityCards = true;
        persistDashboardFilterVisibility(showEntityCards, showAutomationCards, showScriptCards);
      }
    }
    loadBridgeInfo(true);
    loadFrontendSettings();
    loadActivityLogs();
    checkRecordingStatus();
    checkRecordingStatus();

    // Start log flush timer
    logFlushTimer = setInterval(flushLogBuffers, LOG_FLUSH_INTERVAL);
  });

  const flushLogBuffers = () => {
    if (commandLogBuffer.length > 0) {
      // Sort buffer by timestamp descending (newest first)
      commandLogBuffer.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));

      // Optimization: If the newest buffered log is newer than the newest existing log,
      // we can just unshift. This is the most common case for real-time logs.
      const newestBufferTs = commandLogBuffer[0].timestampMs ?? 0;
      const newestExistingTs =
        commandPacketLogs.length > 0 ? (commandPacketLogs[0].timestampMs ?? 0) : 0;

      if (commandPacketLogs.length === 0 || newestBufferTs >= newestExistingTs) {
        // Prepend all
        commandPacketLogs.unshift(...commandLogBuffer);
      } else {
        // Fallback: insert one by one (or could optimize further to merge-sort)
        // Since out-of-order logs are rare in real-time view, this is acceptable.
        for (const entry of commandLogBuffer) {
          insertSortedLogEntry(commandPacketLogs, entry);
        }
      }

      // Trim if needed
      if (commandPacketLogs.length > MAX_PACKETS) {
        commandPacketLogs.length = MAX_PACKETS;
      }

      commandLogBuffer = [];
    }

    if (parsedLogBuffer.length > 0) {
      // Sort buffer by timestamp descending
      parsedLogBuffer.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));

      const newestBufferTs = parsedLogBuffer[0].timestampMs ?? 0;
      const newestExistingTs =
        parsedPacketLogs.length > 0 ? (parsedPacketLogs[0].timestampMs ?? 0) : 0;

      if (parsedPacketLogs.length === 0 || newestBufferTs >= newestExistingTs) {
        parsedPacketLogs.unshift(...parsedLogBuffer);
      } else {
        for (const entry of parsedLogBuffer) {
          insertSortedLogEntry(parsedPacketLogs, entry);
        }
      }

      if (parsedPacketLogs.length > MAX_PACKETS) {
        parsedPacketLogs.length = MAX_PACKETS;
      }

      parsedLogBuffer = [];
    }
  };

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
    // WebSocket 연결 상태와 activeView를 의존성으로 사용하여 reactive하게 동작
    if (!isSocketOpen) return;

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
    if (!isStreaming || !isSocketOpen) return;
    if (rawPacketStreamMode === lastAppliedRawPacketMode) return;
    lastAppliedRawPacketMode = rawPacketStreamMode;
    rawPackets = [];
    logVersion += 1;
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
    logVersion += 1;
    packetStatsByPort = new Map();
  }

  async function loadBridgeInfo(force = false) {
    if (infoLoading && !force) return;

    infoLoading = true;
    infoError = '';

    try {
      const data = await apiRequest<BridgeInfo>('./api/bridge/info');

      bridgeInfo = data;
      setTimeZone(data.timezone);
      bridgeStatusByPort = new Map();
      rawPackets = [];
      logVersion += 1;
      deviceStates.clear();
      parsedStates.clear();
      entityErrorsByKey = new Map();
      packetStatsByPort = new Map();

      const portIds =
        data.bridges?.reduce<string[]>(
          (acc, bridge) => (bridge.serial ? acc.concat(bridge.serial.portId) : acc),
          [],
        ) ?? [];
      const defaultPortId = portIds[0] ?? null;
      if (!selectedPortId || (selectedPortId && !portIds.includes(selectedPortId))) {
        selectedPortId = defaultPortId;
      }

      // Initialize mqttConnectionStatus from API response (for cases where MQTT is already connected)
      if ((data as any).mqttConnected) {
        mqttConnectionStatus = 'connected';
      }

      connectWebSocket();

      if (bridgeInfo.configFiles && bridgeInfo.configFiles.length > 0) {
        loadCommands();
        loadConfiguredEntities();
        loadAutomations();
        loadScripts();
        loadPacketHistory();
      }
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
      const [cmdsResponse, parsedResponse] = await Promise.all([
        apiRequest<PacketHistoryResponse<CommandLogEntry>>('./api/packets/command/history'),
        apiRequest<PacketHistoryResponse<PacketLogEntry>>('./api/packets/parsed/history'),
      ]);

      // Merge dictionaries from both responses
      packetDictionary = {
        ...packetDictionary,
        ...cmdsResponse.dictionary,
        ...parsedResponse.dictionary,
      };

      // Store raw logs with packetId (optimized)
      const enrichedCommandLogs = cmdsResponse.logs
        .map((entry) => enrichCommandLogEntry(entry, packetDictionary[entry.packetId] || ''))
        .sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
      const enrichedParsedLogs = parsedResponse.logs
        .map((entry) => enrichParsedLogEntry(entry, packetDictionary[entry.packetId] || ''))
        .sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
      commandPacketLogs = enrichedCommandLogs.slice(0, MAX_PACKETS);
      parsedPacketLogs = enrichedParsedLogs.slice(0, MAX_PACKETS);
      logVersion += 1;
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

  async function updateActivityLogSetting(value: boolean) {
    const previous = frontendSettings ?? DEFAULT_FRONTEND_SETTINGS;
    const next: FrontendSettings = {
      ...previous,
      activityLog: {
        ...(previous.activityLog ?? DEFAULT_FRONTEND_SETTINGS.activityLog),
        hideAutomationScripts: value,
      },
    };
    frontendSettings = next;
    try {
      await persistFrontendSettings(next);
    } catch {
      frontendSettings = previous;
    }
  }

  async function updateEditorSetting(value: 'monaco' | 'textarea') {
    const previous = frontendSettings ?? DEFAULT_FRONTEND_SETTINGS;
    const next: FrontendSettings = {
      ...previous,
      editor: {
        ...(previous.editor ?? { default: 'monaco' }),
        default: value,
      },
    };
    frontendSettings = next;
    try {
      await persistFrontendSettings(next);
    } catch {
      frontendSettings = previous;
    }
  }

  function toggleInactiveEntities() {
    showInactiveEntities = !showInactiveEntities;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DASHBOARD_INACTIVE_KEY, String(showInactiveEntities));
    }
  }

  function toggleEntityCards() {
    showEntityCards = !showEntityCards;
    persistDashboardFilterVisibility(showEntityCards, showAutomationCards, showScriptCards);
  }

  function toggleAutomationCards() {
    showAutomationCards = !showAutomationCards;
    persistDashboardFilterVisibility(showEntityCards, showAutomationCards, showScriptCards);
  }

  function toggleScriptCards() {
    showScriptCards = !showScriptCards;
    persistDashboardFilterVisibility(showEntityCards, showAutomationCards, showScriptCards);
  }

  let socketCloseHandler: (() => void) | null = null;
  let socketErrorHandler: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connectWebSocket() {
    if (typeof window === 'undefined' || !bridgeInfo) return;

    closeStream();

    // ingress 환경에서는 window.location을 기준으로 해야 Supervisor 토큰이 포함된다
    const baseUrl = typeof window !== 'undefined' ? window.location.href : document.baseURI;
    const url = new URL('./api/stream', baseUrl);
    if (bridgeInfo.mqttUrl.trim().length > 0) {
      url.searchParams.set('mqttUrl', bridgeInfo.mqttUrl.trim());
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    socket = new WebSocket(url.toString());

    const handleStatus = (data: Record<string, unknown> & { error?: BridgeErrorPayload }) => {
      const state = data.state;
      if (state === 'connected') {
        mqttConnectionStatus = 'connected';
        statusMessage = { key: 'mqtt.connected' };
      } else if (state === 'subscribed') {
        mqttConnectionStatus = 'connected';
        statusMessage = { key: 'mqtt.subscribed', values: { topic: data.topic } };
      } else if (state === 'error') {
        mqttConnectionStatus = 'error';
        if (data.error?.code) {
          statusMessage = { key: `errors.${data.error.code}` };
        } else {
          // Error messages from server might be raw strings.
          statusMessage = {
            key: typeof data.message === 'string' ? data.message : 'mqtt.error',
          };
        }
      } else if (state === 'connecting') {
        mqttConnectionStatus = 'connecting';
        statusMessage = { key: 'mqtt.connecting' };
      } else if (state === 'disconnected') {
        mqttConnectionStatus = 'connecting';
        statusMessage = { key: 'mqtt.disconnected' };
      }
    };

    const handleDeviceStateMessage = (data: MqttMessageEvent & { portId?: string }) => {
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
      logVersion += 1;
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
      logVersion += 1;
    };

    const handlePacketStats = (data: PacketStats) => {
      if (data && data.portId) {
        // When in 'valid' mode, use valid packet stats if available
        let statsToStore: PacketStats;
        if (rawPacketStreamMode === 'valid' && data.valid) {
          // Use valid packet interval stats but keep portId and valid field
          statsToStore = {
            ...data.valid,
            portId: data.portId,
            valid: data.valid,
          };
        } else {
          statsToStore = data;
        }
        packetStatsByPort.set(data.portId, statsToStore);
        packetStatsByPort = new Map(packetStatsByPort);
      }
    };

    // Helper to get or create packetId from packet string
    let packetIdCounter = Object.keys(packetDictionary).length;
    const getOrCreatePacketId = (packet: string): string => {
      // Check if packet already exists in dictionary
      for (const [id, p] of Object.entries(packetDictionary)) {
        if (p === packet) return id;
      }
      // Create new entry
      const newId = `p${++packetIdCounter}`;
      packetDictionary = { ...packetDictionary, [newId]: packet };
      return newId;
    };

    const handleCommandPacket = (data: CommandPacket) => {
      // Convert to log entry and store
      const packetId = getOrCreatePacketId(data.packet);
      const logEntry: CommandLogEntry = enrichCommandLogEntry(
        {
          packetId,
          entity: data.entity,
          entityId: data.entityId,
          command: data.command,
          value: data.value,
          timestamp: data.timestamp,
          portId: data.portId,
          sourceEntityId: data.sourceEntityId,
        },
        data.packet,
      );
      // Buffer the log instead of inserting immediately
      commandLogBuffer.push(logEntry);

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
      // Convert to log entry and store
      const packetId = getOrCreatePacketId(data.packet);
      const logEntry: PacketLogEntry = enrichParsedLogEntry(
        {
          packetId,
          entityId: data.entityId,
          state: data.state,
          timestamp: data.timestamp,
          portId: data.portId,
        },
        data.packet,
      );
      // Buffer the log instead of inserting immediately
      parsedLogBuffer.push(logEntry);
    };

    const handleStateChange = (data: StateChangeEvent) => {
      const portId = getExplicitPortId(data.portId, data.topic);
      deviceStates.set(data.topic, {
        payload: data.payload,
        portId,
      });
      deviceStates = new Map(deviceStates);
      if (data.state && typeof data.state === 'object' && !Array.isArray(data.state)) {
        const entityId = extractEntityIdFromTopic(data.topic);
        const stateKey = makeEntityKey(portId, entityId, 'entity');
        parsedStates.set(stateKey, {
          entityId,
          portId,
          state: data.state as Record<string, unknown>,
        });
        parsedStates = new Map(parsedStates);
      }

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

    const handleEntityError = (data: EntityErrorEvent) => {
      const key = makeEntityKey(data.portId, data.entityId, 'entity');
      const existing = entityErrorsByKey.get(key) ?? [];
      const next = [data, ...existing].slice(0, MAX_ENTITY_ERRORS);
      entityErrorsByKey.set(key, next);
      entityErrorsByKey = new Map(entityErrorsByKey);
    };

    const messageHandlers: Partial<Record<StreamEvent, (data: any) => void>> = {
      status: handleStatus,
      'mqtt-message': handleDeviceStateMessage,
      'raw-data': handleRawPacketFallback,
      'raw-data-with-interval': handleRawPacketWithInterval,
      'packet-interval-stats': handlePacketStats,
      'command-packet': handleCommandPacket,
      'parsed-packet': handleParsedPacket,
      'state-change': handleStateChange,
      'activity-log-added': handleActivityLogAdded,
      'entity-error': handleEntityError,
    };

    socket.addEventListener('open', () => {
      isSocketOpen = true;
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
      // WebSocket disconnected - MQTT status becomes unknown, show as connecting
      mqttConnectionStatus = 'connecting';
      statusMessage = { key: 'mqtt.disconnected' };
      socket = null;
      socketCloseHandler = null;
      socketErrorHandler = null;
      isStreaming = false;

      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connectWebSocket();
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
    mqttConnectionStatus = 'idle';
    isSocketOpen = false;
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
    if (logFlushTimer) clearInterval(logFlushTimer);
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

  async function loadConfiguredEntities() {
    try {
      const data = await apiRequest<{ entities: ConfigEntitySummary[] }>('./api/entities');
      configuredEntities = data.entities ?? [];
    } catch (err) {
      console.error('Failed to load configured entities:', err);
      configuredEntities = [];
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
          portId: cmd.portId,
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
      await loadConfiguredEntities();

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

  function handleEntityUpdate(
    entityId: string,
    portId: string | undefined,
    updates: Partial<UnifiedEntity>,
  ) {
    const { discoveryAlways } = updates;

    if (discoveryAlways !== undefined) {
      configuredEntities = configuredEntities.map((e) =>
        e.entityId === entityId ? { ...e, discoveryAlways } : e,
      );

      availableCommands = availableCommands.map((cmd) =>
        cmd.entityId === entityId && (!portId || cmd.portId === portId)
          ? { ...cmd, discoveryAlways }
          : cmd,
      );
    }
  }

  type PortMetadata = BridgeSerialInfo & {
    configFile: string;
    error?: string;
    errorInfo?: BridgeErrorPayload | null;
    status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
  };

  const portMetadata = $derived.by(() => {
    if (!bridgeInfo?.bridges) return [] as PortMetadata[];

    // 1. Flatten all ports from all bridges
    const allPorts = bridgeInfo.bridges.reduce<PortMetadata[]>((acc, bridge) => {
      if (!bridge.serial && (bridge.error || bridge.status === 'error')) {
        // Serials가 없지만 에러가 있는 경우, placeholder 포트를 추가하여 UI 탭에 표시되도록 함
        return acc.concat([
          {
            portId: bridge.configFile, // 파일명을 ID로 사용
            path: '',
            baudRate: 0,
            topic: '',
            configFile: bridge.configFile,
            error: bridge.error,
            errorInfo: bridge.errorInfo ?? null,
            status: bridge.status,
          },
        ]);
      }
      if (bridge.serial) {
        return acc.concat([
          {
            ...bridge.serial,
            configFile: bridge.configFile,
            error: bridge.error,
            errorInfo: bridge.errorInfo ?? null,
            status: bridge.status,
          },
        ]);
      }

      return acc;
    }, []);

    // 2. Deduplicate by portId
    const uniquePorts: typeof allPorts = [];
    const seenIds = new Set<string>();

    for (const port of allPorts) {
      if (!seenIds.has(port.portId)) {
        seenIds.add(port.portId);
        uniquePorts.push(port);
      }
    }

    return uniquePorts;
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

    // 1. Initialize with Configured Entities (Include read-only sensors)
    for (const entity of configuredEntities) {
      const portId =
        entity.portId ??
        (entity.configFile ? configPortMap.get(entity.configFile) : null) ??
        undefined;
      const key = makeKey(portId, entity.entityId, 'entity');

      if (!entities.has(key)) {
        entities.set(key, {
          id: entity.entityId,
          displayName: entity.entityName || entity.entityId,
          type: entity.entityType,
          category: 'entity',
          commands: [],
          isStatusDevice: false,
          portId,
          discoveryAlways: entity.discoveryAlways,
          discoveryLinkedId: entity.discoveryLinkedId,
        });
      }
    }

    // 2. Initialize with Commands (Source of Truth for Configured Names)
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
      entity.displayName = cmd.entityName || entity.displayName;
      entity.type = cmd.entityType || entity.type;
      entity.commands.push({ ...cmd, portId });
      // Merge discovery flags if present on any command (though they should be consistent per entity)
      if (cmd.discoveryAlways) entity.discoveryAlways = true;
      if (cmd.discoveryLinkedId) entity.discoveryLinkedId = cmd.discoveryLinkedId;
    }

    // 3. Merge States
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
        (automation.configFile ? configPortMap.get(automation.configFile) : null) ?? undefined;
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
          args: script.args,
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

    for (const entity of entities.values()) {
      const key = makeKey(entity.portId, entity.id, entity.category ?? 'entity');
      entity.errorCount = entityErrorsByKey.get(key)?.length ?? 0;
    }

    return Array.from(entities.values());
  });

  const unifiedEntities = $derived.by<UnifiedEntity[]>(() => {
    const filtered = allUnifiedEntities.filter((entity) => {
      if (!showInactiveEntities && !entity.isActive) return false;
      if (entity.category === 'automation') return showAutomationCards;
      if (entity.category === 'script') return showScriptCards;
      return showEntityCards;
    });
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

  const isMultiPortAnalysis = $derived.by<boolean>(
    () => !activePortId && availablePortIds.length > 1,
  );

  const getAnalyzerStateKey = (portId: string | undefined, entityId: string) =>
    isMultiPortAnalysis ? `${portId ?? 'unknown'}:${entityId}` : entityId;

  const analysisStateSnapshot = $derived.by<Record<string, Record<string, unknown>>>(() => {
    const snapshot: Record<string, Record<string, unknown>> = {};
    for (const entry of parsedStates.values()) {
      if (activePortId && entry.portId && entry.portId !== activePortId) continue;
      const key = getAnalyzerStateKey(entry.portId, entry.entityId);
      snapshot[key] = entry.state;
    }
    return snapshot;
  });

  const analysisStateOptions = $derived.by<AnalyzerStateOption[]>(() => {
    const labelMap = new Map<string, string>();
    for (const entity of allUnifiedEntities) {
      if (entity.category !== 'entity') continue;
      if (activePortId && entity.portId && entity.portId !== activePortId) continue;
      const key = getAnalyzerStateKey(entity.portId, entity.id);
      const label =
        isMultiPortAnalysis && entity.portId
          ? `${entity.displayName} (${entity.portId})`
          : entity.displayName;
      labelMap.set(key, label);
    }

    const options: AnalyzerStateOption[] = [];
    for (const entry of parsedStates.values()) {
      if (activePortId && entry.portId && entry.portId !== activePortId) continue;
      const key = getAnalyzerStateKey(entry.portId, entry.entityId);
      options.push({
        id: key,
        label: labelMap.get(key) ?? entry.entityId,
        state: entry.state,
        portId: entry.portId,
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
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

  const selectedEntityErrors = $derived.by<EntityErrorEvent[]>(() => {
    if (!selectedEntity) return [];
    const key = makeEntityKey(
      selectedEntity.portId,
      selectedEntity.id,
      selectedEntity.category ?? 'entity',
    );
    return entityErrorsByKey.get(key) ?? [];
  });

  const selectedEntityParsedPackets = $derived.by<ParsedPacket[]>(() => {
    logVersion;
    return selectedEntity && selectedEntity.category === 'entity'
      ? parsedPacketLogs
          .filter(
            (p) =>
              p.entityId === selectedEntity.id &&
              (!selectedEntity.portId || !p.portId || p.portId === selectedEntity.portId),
          )
          .slice(0, 20)
          .map((log) => ({
            entityId: log.entityId,
            packet: packetDictionary[log.packetId] || '',
            state: log.state,
            timestamp: log.timestamp,
            portId: log.portId,
            timestampMs: log.timestampMs,
            timeLabel: log.timeLabel,
            searchText: log.searchText,
          }))
      : [];
  });

  const selectedEntityCommandPackets = $derived.by<CommandPacket[]>(() => {
    logVersion;
    return selectedEntity && selectedEntity.category === 'entity'
      ? commandPacketLogs
          .filter(
            (p) =>
              (p.entityId === selectedEntity.id || p.sourceEntityId === selectedEntity.id) &&
              (!selectedEntity.portId || !p.portId || p.portId === selectedEntity.portId),
          )
          .slice(0, 20)
          .map((log) => ({
            entity: log.entity,
            entityId: log.entityId,
            command: log.command,
            value: log.value,
            packet: packetDictionary[log.packetId] || '',
            timestamp: log.timestamp,
            portId: log.portId,
            timestampMs: log.timestampMs,
            timeLabel: log.timeLabel,
            searchText: log.searchText,
            sourceEntityId: log.sourceEntityId,
          }))
      : [];
  });

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
    // 일반 엔티티: entityId로 상태 변경 로그 + sourceEntityId로 스크립트 실행 로그 필터링
    return activityLogs.filter(
      (log) =>
        log.params?.entityId === selectedEntity.id ||
        log.params?.sourceEntityId === selectedEntity.id,
    );
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

  const filteredCommandLogs = $derived.by<CommandLogEntry[]>(() => {
    logVersion; // Register dependency
    return activePortId
      ? commandPacketLogs.filter((log) => !log.portId || log.portId === activePortId)
      : commandPacketLogs;
  });

  const filteredParsedLogs = $derived.by<PacketLogEntry[]>(() => {
    logVersion; // Register dependency
    return activePortId
      ? parsedPacketLogs.filter((log) => !log.portId || log.portId === activePortId)
      : parsedPacketLogs;
  });

  const filteredRawPackets = $derived.by<RawPacketWithInterval[]>(() => {
    logVersion; // Register dependency
    return activePortId
      ? rawPackets.filter((packet) => !packet.portId || packet.portId === activePortId)
      : rawPackets;
  });

  const filteredPacketStats = $derived.by<PacketStats | null>(() =>
    activePortId ? (packetStatsByPort.get(activePortId) ?? null) : null,
  );

  const filteredActivityLogs = $derived.by<ActivityLog[]>(() => {
    const baseLogs = activePortId
      ? activityLogs.filter((log) => !log.portId || log.portId === activePortId)
      : activityLogs;
    const shouldHideAutomationScripts =
      (frontendSettings ?? DEFAULT_FRONTEND_SETTINGS).activityLog?.hideAutomationScripts ?? false;
    if (!shouldHideAutomationScripts) return baseLogs;
    return baseLogs.filter(
      (log) => !log.code.startsWith('log.automation_') && !log.code.startsWith('log.script_'),
    );
  });

  const portStatuses = $derived.by(() => {
    const defaultStatus = bridgeInfo?.status ?? 'idle';
    return portMetadata.map((port) => {
      // 1. If explicit startup error (from config loading/connect failure)
      if (port.error || port.errorInfo) {
        return {
          portId: port.portId,
          status: 'error' as BridgeStatus,
          message: resolveBridgeErrorMessage(port.errorInfo ?? port.error),
          errorInfo: port.errorInfo ?? null,
        };
      }

      // 2. If the bridge reports a specific status (e.g. 'starting', 'error') via API
      if (port.status && port.status !== 'idle' && port.status !== 'started') {
        return {
          portId: port.portId,
          status: port.status as BridgeStatus,
          message: undefined,
          errorInfo: port.errorInfo ?? null,
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
        errorInfo: port.errorInfo ?? null,
      };
    });
  });
</script>

{#if $isLoading}
  <div class="loading-screen">Loading resources...</div>
{:else}
  <a href="#main-content" class="skip-link">{$t('header.skip_to_content')}</a>
  <main class="app-container">
    <Header
      onToggleSidebar={() => (isSidebarOpen = !isSidebarOpen)}
      portIds={availablePortIds}
      {activePortId}
      {portStatuses}
      onPortChange={(portId) => (selectedPortId = portId)}
      hasLoadError={!!infoError}
      onAddBridge={() => {
        if (activeView !== 'dashboard') {
          activeView = 'dashboard';
        }
        showAddBridgeModal = true;
      }}
    />
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
            showEntities={showEntityCards}
            showAutomations={showAutomationCards}
            showScripts={showScriptCards}
            {hasInactiveEntities}
            activityLogs={filteredActivityLogs}
            {mqttConnectionStatus}
            {portStatuses}
            onSelect={(entityId, portId, category) =>
              (selectedEntityKey = makeEntityKey(portId, entityId, category))}
            onToggleInactive={toggleInactiveEntities}
            onToggleEntities={toggleEntityCards}
            onToggleAutomations={toggleAutomationCards}
            onToggleScripts={toggleScriptCards}
          />
        {:else if activeView === 'analysis'}
          <Analysis
            stats={filteredPacketStats}
            commandPackets={[]}
            parsedPackets={[]}
            commandLogs={filteredCommandLogs}
            parsedLogs={filteredParsedLogs}
            rawPackets={filteredRawPackets}
            {packetDictionary}
            {isStreaming}
            {portMetadata}
            {activePortId}
            stateOptions={analysisStateOptions}
            statesSnapshot={analysisStateSnapshot}
            onStart={handleRawRecordingStart}
            bind:validOnly={validRawPacketsOnly}
            bind:isRecording
            bind:recordingStartTime
            bind:recordedFile
            logRetentionEnabled={frontendSettings?.logRetention?.enabled ?? false}
          />
        {:else if activeView === 'gallery'}
          <Gallery {portMetadata} {portStatuses} {activePortId} />
        {:else if activeView === 'settings'}
          <SettingsView
            {frontendSettings}
            {bridgeInfo}
            isLoading={settingsLoading}
            error={settingsError}
            isSaving={settingsSaving}
            onToastChange={(key, value) => updateToastSetting(key, value)}
            onActivityLogChange={(value) => updateActivityLogSetting(value)}
            onLocaleChange={(value) => updateLocaleSetting(value)}
            onEditorChange={(value) => updateEditorSetting(value)}
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
        entityErrors={selectedEntityErrors}
        onClose={() => (selectedEntityKey = null)}
        onExecute={(cmd, value) => executeCommand(cmd, value)}
        isRenaming={renamingEntityId === selectedEntity.id}
        {renameError}
        onRename={(newName) =>
          selectedEntity && renameEntityRequest(selectedEntity.id, newName, selectedEntity.portId)}
        onUpdate={(updates) =>
          selectedEntity && handleEntityUpdate(selectedEntity.id, selectedEntity.portId, updates)}
        editorMode={frontendSettings?.editor?.default ?? 'monaco'}
      />
    {/if}

    {#if showAddBridgeModal}
      <SetupWizard mode="add" onclose={() => (showAddBridgeModal = false)} />
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
