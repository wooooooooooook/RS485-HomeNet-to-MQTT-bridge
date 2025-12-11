<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type {
    BridgeInfo,
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
  } from './lib/types';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Header from './lib/components/Header.svelte';
  import Dashboard from './lib/views/Dashboard.svelte';
  import Analysis from './lib/views/Analysis.svelte';

  import EntityDetail from './lib/components/EntityDetail.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
  import SettingsView from './lib/views/Settings.svelte';

  const MAX_PACKETS = 1000;

  // -- State --
  let activeView: 'dashboard' | 'analysis' | 'settings' = 'dashboard';
  let selectedEntityId: string | null = null;
  let isSidebarOpen = false;
  let showInactiveEntities = false;

  let bridgeInfo: BridgeInfo | null = null;
  let infoLoading = false;
  let infoError = '';

  let commandPackets: CommandPacket[] = [];
  let deviceStates = new Map<string, string>();
  let socket: WebSocket | null = null;
  let connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  let statusMessage = '';
  let isStreaming = false;

  // Command buttons state
  let availableCommands: CommandInfo[] = [];
  let commandsLoading = false;
  let commandsError = '';
  // Generic input state map for various input types

  let executingCommands: Set<string> = new Set();

  let rawPackets: RawPacketWithInterval[] = [];
  let parsedPackets: ParsedPacket[] = [];
  let packetStats: PacketStats | null = null;
  let hasIntervalPackets = false;
  let lastRawPacketTimestamp: number | null = null;
  let toasts: ToastMessage[] = [];
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
  let frontendSettings: FrontendSettings | null = null;
  let settingsLoading = false;
  let settingsError = '';
  let settingsSaving = false;
  let renamingEntityId: string | null = null;
  let renameError = '';

  type StreamEvent =
    | 'status'
    | 'mqtt-message'
    | 'raw-data'
    | 'raw-data-with-interval'
    | 'packet-interval-stats'
    | 'command-packet'
    | 'parsed-packet'
    | 'state-change';

  type StreamMessage<T = unknown> = {
    event: StreamEvent;
    data: T;
  };

  const normalizeRawPacket = (
    data: Partial<RawPacketWithInterval> & { payload?: string },
  ): RawPacketWithInterval => ({
    topic: data.topic ?? 'homenet2mqtt/raw',
    payload: data.payload ?? '',
    receivedAt: data.receivedAt ?? new Date().toISOString(),
    interval: typeof data.interval === 'number' ? data.interval : null,
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

  async function loadBridgeInfo(force = false) {
    if (infoLoading && !force) return;

    infoLoading = true;
    infoError = '';

    try {
      const data = await apiRequest<BridgeInfo>('./api/bridge/info');

      bridgeInfo = data;
      rawPackets = [];
      deviceStates.clear();
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
      commandPackets = cmds;
      parsedPackets = parsed;
    } catch (err) {
      console.error('Failed to load packet history:', err);
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

    const handleMqttMessage = (data: MqttMessageEvent) => {
      if (!isStateTopic(data.topic)) return;
      deviceStates.set(data.topic, data.payload);
      deviceStates = deviceStates; // Trigger Svelte reactivity
    };

    const handleRawPacketWithInterval = (data: RawPacketWithInterval) => {
      hasIntervalPackets = true;
      const packet = normalizeRawPacket(data);
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
        }),
      );
    };

    const handlePacketStats = (data: PacketStats) => {
      if (data) {
        packetStats = data;
      }
    };

    const handleCommandPacket = (data: CommandPacket) => {
      commandPackets = [...commandPackets, data].slice(-MAX_PACKETS);
      if (!isToastEnabled('command')) return;
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
      parsedPackets = [...parsedPackets, data].slice(-MAX_PACKETS);
    };

    const handleStateChange = (data: StateChangeEvent) => {
      if (!isToastEnabled('state')) return;
      const summary = formatStateSummary(data.state);
      addToast({
        type: 'state',
        title: `${extractEntityIdFromTopic(data.topic)} 상태 업데이트`,
        message: summary || data.payload || '상태가 갱신되었습니다.',
        timestamp: data.timestamp,
      });
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
      connectionStatus = 'error';
      statusMessage = '스트림 연결이 끊어졌습니다. 잠시 후 다시 시도하세요.';
      socket = null;
      socketCloseHandler = null;
      socketErrorHandler = null;
      isStreaming = false;
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
    packetStats = null;
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

  const normalizeTopicParts = (topic: string) => topic.split('/').filter(Boolean);

  const isBridgeStatusTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);
    return parts.slice(-2).join('/') === 'bridge/status';
  };

  const isStateTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);
    return parts.length >= 3 && parts[parts.length - 1] === 'state';
  };

  const extractEntityIdFromTopic = (topic: string) => {
    const parts = normalizeTopicParts(topic);

    if (parts.length >= 3) {
      const [, , ...rest] = parts;
      const [entityId] = rest;
      if (entityId) {
        return entityId;
      }
    }

    if (parts.length >= 2 && ['state', 'set', 'availability', 'attributes'].includes(parts.at(-1) || '')) {
      return parts[parts.length - 2];
    }

    return parts[parts.length - 1] ?? topic;
  };

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

  async function renameEntityRequest(entityId: string, newName: string) {
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
        body: JSON.stringify({ entityId, newName: trimmed }),
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

  // --- Entity Unification Logic ---

  $: unifiedEntities = (() => {
    const entities = new Map<string, UnifiedEntity>();

    // 1. Initialize with Commands (Source of Truth for Configured Names)
    for (const cmd of availableCommands) {
      if (!entities.has(cmd.entityId)) {
        entities.set(cmd.entityId, {
          id: cmd.entityId,
          displayName: cmd.entityName || cmd.entityId,
          type: cmd.entityType,
          commands: [],
          isStatusDevice: false,
        });
      }
      entities.get(cmd.entityId)!.commands.push(cmd);
    }

    // 2. Merge States
    for (const [topic, payload] of deviceStates.entries()) {
      if (isBridgeStatusTopic(topic)) continue; // Skip bridge status

      const entityId = extractEntityIdFromTopic(topic);

      if (!entities.has(entityId)) {
        // Unknown entity (read-only or no commands configured)
        entities.set(entityId, {
          id: entityId,
          displayName: entityId, // Fallback to ID
          commands: [],
          isStatusDevice: false,
        });
      }

      const entity = entities.get(entityId)!;
      entity.statePayload = payload;
    }

    // Convert to array, filter only those with state, and sort
    const allEntities = Array.from(entities.values());
    const filtered = showInactiveEntities
      ? allEntities
      : allEntities.filter((entity) => entity.statePayload);
    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
  })();

  // --- Entity Detail Logic ---

  $: selectedEntity = selectedEntityId
    ? unifiedEntities.find((e) => e.id === selectedEntityId) || null
    : null;

  $: selectedEntityParsedPackets =
    selectedEntity && parsedPackets
      ? parsedPackets.filter((p) => p.entityId === selectedEntityId).slice(-20)
      : [];

  // Command packets ARE structured with entity property but we now have entityId
  $: selectedEntityCommandPackets =
    selectedEntity && commandPackets
      ? commandPackets.filter((p) => p.entityId === selectedEntityId).slice(-20)
      : [];

  $: if (!selectedEntityId) {
    renameError = '';
    renamingEntityId = null;
  }
</script>

<main class="app-container">
  <Sidebar bind:activeView isOpen={isSidebarOpen} on:close={() => (isSidebarOpen = false)} />

  <section class="main-content">
    <Header
      bridgeStatus={bridgeInfo?.status || 'idle'}
      {connectionStatus}
      {statusMessage}
      onRefresh={() => loadBridgeInfo(true)}
      isRefreshing={infoLoading}
      on:toggleSidebar={() => (isSidebarOpen = !isSidebarOpen)}
    />

    {#if activeView === 'dashboard'}
      <Dashboard
        {bridgeInfo}
        {infoLoading}
        {infoError}
        {unifiedEntities}
        {deviceStates}
        {availableCommands}
        showInactive={showInactiveEntities}
        on:select={(e) => (selectedEntityId = e.detail.entityId)}
        on:toggleInactive={() => (showInactiveEntities = !showInactiveEntities)}
      />
    {:else if activeView === 'analysis'}
      <Analysis
        stats={packetStats}
        {commandPackets}
        {parsedPackets}
        {rawPackets}
        {isStreaming}
        on:start={() => {
          sendStreamCommand('start');
          isStreaming = true;
          rawPackets = [];
          packetStats = null;
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

  {#if selectedEntity}
    <EntityDetail
      entity={selectedEntity}
      isOpen={!!selectedEntityId}
      parsedPackets={selectedEntityParsedPackets}
      commandPackets={selectedEntityCommandPackets}
      on:close={() => (selectedEntityId = null)}
      on:execute={(e) => executeCommand(e.detail.cmd, e.detail.value)}
      isRenaming={renamingEntityId === selectedEntityId}
      renameError={renameError}
      on:rename={(e) => selectedEntityId && renameEntityRequest(selectedEntityId, e.detail.newName)}
    />
  {/if}
</main>

<ToastContainer {toasts} on:dismiss={(event) => removeToast(event.detail.id)} />

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
    min-height: 100vh;
  }

  .main-content {
    flex: 1;
    margin-left: 250px; /* Sidebar width */
    padding: 2rem;
    max-width: 1600px;
    box-sizing: border-box;
  }

  @media (max-width: 768px) {
    .main-content {
      margin-left: 0;
      padding: 1rem;
      padding-top: 80px; /* Space for mobile header usually, but we are keeping it simple for now */
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
