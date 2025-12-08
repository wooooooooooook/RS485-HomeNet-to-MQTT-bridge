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
    ParsedPayloadEntry,
  } from './lib/types';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Header from './lib/components/Header.svelte';
  import Dashboard from './lib/views/Dashboard.svelte';
  import Analysis from './lib/views/Analysis.svelte';

  const MAX_PACKETS = 1000;

  // -- State --
  let activeView: 'dashboard' | 'analysis' = 'dashboard';

  let bridgeInfo: BridgeInfo | null = null;
  let infoLoading = false;
  let infoError = '';

  let commandPackets: CommandPacket[] = [];
  let deviceStates = new Map<string, string>();
  let socket: WebSocket | null = null;
  let connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  let statusMessage = '';
  let isLogPaused = false;

  // Command buttons state
  let availableCommands: CommandInfo[] = [];
  let commandsLoading = false;
  let commandsError = '';
  // Generic input state map for various input types
  let commandInputs: Record<string, any> = {};
  let executingCommands: Set<string> = new Set();

  let rawPackets: RawPacketWithInterval[] = [];
  let packetStats: PacketStats | null = null;
  let hasIntervalPackets = false;
  let lastRawPacketTimestamp: number | null = null;

  type StreamEvent =
    | 'status'
    | 'mqtt-message'
    | 'raw-data'
    | 'raw-data-with-interval'
    | 'packet-interval-stats'
    | 'command-packet';

  type StreamMessage<T = unknown> = {
    event: StreamEvent;
    data: T;
  };

  const normalizeRawPacket = (
    data: Partial<RawPacketWithInterval> & { payload?: string },
  ): RawPacketWithInterval => ({
    topic: data.topic ?? 'homenet/raw',
    payload: data.payload ?? '',
    receivedAt: data.receivedAt ?? new Date().toISOString(),
    interval: typeof data.interval === 'number' ? data.interval : null,
  });

  const appendRawPacket = (packet: RawPacketWithInterval) => {
    if (!isLogPaused) {
      rawPackets = [...rawPackets, packet].slice(-MAX_PACKETS);
    }
  };

  onMount(() => {
    loadBridgeInfo(true);
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
      commandPackets = [];
      deviceStates.clear();
      startMqttStream();
      loadCommands();
    } catch (err) {
      bridgeInfo = null;
      closeStream();
      infoError = err instanceof Error ? err.message : '브리지 정보를 불러오지 못했습니다.';
    } finally {
      infoLoading = false;
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
      if (!isLogPaused) {
        commandPackets = [...commandPackets, data].slice(-MAX_PACKETS);
      }
    };

    const messageHandlers: Partial<Record<StreamEvent, (data: any) => void>> = {
      status: handleStatus,
      'mqtt-message': handleMqttMessage,
      'raw-data': handleRawPacketFallback,
      'raw-data-with-interval': handleRawPacketWithInterval,
      'packet-interval-stats': handlePacketStats,
      'command-packet': handleCommandPacket,
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
    };

    socketCloseHandler = handleDisconnect;
    socketErrorHandler = handleDisconnect;
    socket.addEventListener('close', handleDisconnect);
    socket.addEventListener('error', handleDisconnect);
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

  const isBridgeStatusTopic = (topic: string) => {
    const normalized = topic.replace(/^homenet\//, '');
    return normalized === 'bridge/status';
  };

  const formatTopicName = (topic: string) => {
    const withoutPrefix = topic.replace(/^homenet\//, '');
    return withoutPrefix.replace(/\/state$/, '');
  };

  const extractEntityIdFromTopic = (topic: string) => {
    return formatTopicName(topic);
  };

  onDestroy(closeStream);

  async function loadCommands() {
    commandsLoading = true;
    commandsError = '';
    try {
      const data = await apiRequest<{ commands: CommandInfo[] }>('./api/commands');
      availableCommands = data.commands;
      // Initialize inputs with default values
      for (const cmd of data.commands) {
        if (cmd.inputType === 'number') {
          commandInputs[`${cmd.entityId}_${cmd.commandName}`] = cmd.min ?? 20;
        }
      }
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
    return Array.from(entities.values())
      .filter((entity) => entity.statePayload) // Only show entities with state
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  })();
</script>

<main class="app-container">
  <Sidebar bind:activeView />

  <section class="main-content">
    <Header
      bridgeStatus={bridgeInfo?.status || 'idle'}
      {connectionStatus}
      {statusMessage}
      onRefresh={() => loadBridgeInfo(true)}
      isRefreshing={infoLoading}
    />

    {#if activeView === 'dashboard'}
      <Dashboard
        {bridgeInfo}
        {infoLoading}
        {infoError}
        {unifiedEntities}
        {deviceStates}
        {availableCommands}
        {executingCommands}
        {commandInputs}
        on:execute={(e) => executeCommand(e.detail.cmd, e.detail.value)}
      />
    {:else if activeView === 'analysis'}
      <Analysis
        stats={packetStats}
        {commandPackets}
        {rawPackets}
        {isLogPaused}
        togglePause={() => (isLogPaused = !isLogPaused)}
      />
    {/if}
  </section>
</main>

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
