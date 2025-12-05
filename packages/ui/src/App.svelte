<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  type MqttMessageEvent = {
    topic: string;
    payload: string;
    receivedAt: string;
  };

  type CommandPacket = {
    entity: string;
    command: string;
    value: any;
    packet: string;
    timestamp: string;
  };

  type BridgeStatus = 'idle' | 'starting' | 'started' | 'stopped' | 'error';

  type CommandInfo = {
    entityId: string;
    entityName: string;
    entityType: string;
    commandName: string;
    displayName: string;
    inputType?: 'number';
    min?: number;
    max?: number;
    step?: number;
  };

  type BridgeInfo = {
    configFile: string;
    serialPath: string;
    baudRate: number;
    mqttUrl: string;
    status: BridgeStatus;
    error?: string | null;
    topic: string;
  };

  const MAX_PACKETS = 1000;
  const bridgeStatusLabels: Record<BridgeStatus, string> = {
    idle: '브리지를 준비하는 중입니다.',
    starting: '브리지를 시작하는 중입니다...',
    started: '브리지가 실행 중입니다.',
    stopped: '브리지가 중지되었습니다.',
    error: '브리지 오류가 발생했습니다.',
  };

  let bridgeInfo: BridgeInfo | null = null;
  let infoLoading = false;
  let infoError = '';
  let commandPackets: CommandPacket[] = [];
  let deviceStates = new Map<string, string>();
  let eventSource: EventSource | null = null;
  let connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  let statusMessage = '';
  let isLogPaused = false;

  // Command buttons state
  let availableCommands: CommandInfo[] = [];
  let commandsLoading = false;
  let commandsError = '';
  let temperatureInputs: Record<string, number> = {};
  let executingCommands: Set<string> = new Set();

  type RawPacketWithInterval = MqttMessageEvent & {
    interval: number | null;
  };

  type PacketStats = {
    packetAvg: number;
    packetStdDev: number;
    idleAvg: number;
    idleStdDev: number;
    idleOccurrenceAvg: number;
    idleOccurrenceStdDev: number;
    sampleSize: number;
  };

  let rawPackets: RawPacketWithInterval[] = [];
  let packetStats: PacketStats | null = null;

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
      console.log(response);
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

  function startMqttStream() {
    if (typeof window === 'undefined' || !bridgeInfo) return;

    closeStream();

    connectionStatus = 'connecting';
    statusMessage = 'MQTT 스트림을 연결하는 중입니다...';

    const url = new URL('./api/packets/stream', window.location.href);
    if (bridgeInfo.mqttUrl.trim().length > 0) {
      url.searchParams.set('mqttUrl', bridgeInfo.mqttUrl.trim());
    }

    eventSource = new EventSource(url.toString());

    const handleStatus = (event: MessageEvent<string>) => {
      const data = safeParse<Record<string, unknown>>(event.data);
      if (!data) return;

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

    const handleMqttMessage = (event: MessageEvent<string>) => {
      const data = safeParse<MqttMessageEvent>(event.data);
      if (!data) return;
      deviceStates.set(data.topic, data.payload);
      deviceStates = deviceStates; // Trigger Svelte reactivity
    };

    const handleRawPacketWithInterval = (event: MessageEvent<string>) => {
      const data = safeParse<RawPacketWithInterval>(event.data);
      if (!data) return;

      if (!isLogPaused) {
        rawPackets = [...rawPackets, data].slice(-MAX_PACKETS);
      }
    };

    const handlePacketStats = (event: MessageEvent<string>) => {
      const data = safeParse<PacketStats>(event.data);
      if (data) {
        packetStats = data;
      }
    };

    const handleCommandPacket = (event: MessageEvent<string>) => {
      const data = safeParse<CommandPacket>(event.data);
      if (!data) return;

      if (!isLogPaused) {
        commandPackets = [...commandPackets, data].slice(-MAX_PACKETS);
      }
    };

    eventSource.addEventListener('status', handleStatus);
    eventSource.addEventListener('mqtt-message', handleMqttMessage);
    eventSource.addEventListener('raw-data-with-interval', handleRawPacketWithInterval);
    eventSource.addEventListener('packet-interval-stats', handlePacketStats);
    eventSource.addEventListener('command-packet', handleCommandPacket);
    eventSource.onerror = () => {
      connectionStatus = 'error';
      statusMessage = '스트림 연결이 끊어졌습니다. 잠시 후 다시 시도하세요.';
    };
  }

  function closeStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    connectionStatus = 'idle';
    statusMessage = '';
    packetStats = null;
  }

  function safeParse<T>(value: string): T | null {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];

  type ParsedPayloadEntry = {
    key: string;
    value: string;
  };

  const formatPayloadValue = (value: unknown): string => {
    if (value === null) return 'null';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object]';
      }
    }
    return String(value);
  };

  const parsePayload = (payload: string): ParsedPayloadEntry[] | null => {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed)) {
          return parsed.map((value, index) => ({
            key: String(index),
            value: formatPayloadValue(value),
          }));
        }
        return Object.entries(parsed).map(([key, value]) => ({
          key,
          value: formatPayloadValue(value),
        }));
      }
    } catch {
      return null;
    }

    return null;
  };

  const isBridgeStatusTopic = (topic: string) => {
    const normalized = topic.replace(/^homenet\//, '');
    return normalized === 'bridge/status';
  };

  const formatTopicName = (topic: string) => {
    const withoutPrefix = topic.replace(/^homenet\//, '');
    return withoutPrefix.replace(/\/state$/, '');
  };

  const toPrintableAscii = (value: string) =>
    value
      .split('')
      .map((char) => {
        const code = char.charCodeAt(0);
        if (code >= 32 && code <= 126) return char;
        if (char === '\n') return '⏎';
        if (char === '\r') return '↵';
        if (char === '\t') return '⇥';
        return '·';
      })
      .join('');

  onDestroy(closeStream);

  async function loadCommands() {
    commandsLoading = true;
    commandsError = '';
    try {
      const data = await apiRequest<{ commands: CommandInfo[] }>('./api/commands');
      availableCommands = data.commands;
      // Initialize temperature inputs with default values
      for (const cmd of data.commands) {
        if (cmd.inputType === 'number') {
          temperatureInputs[`${cmd.entityId}_${cmd.commandName}`] = cmd.min ?? 20;
        }
      }
    } catch (err) {
      commandsError = err instanceof Error ? err.message : '명령 목록을 불러오지 못했습니다.';
    } finally {
      commandsLoading = false;
    }
  }

  async function executeCommand(cmd: CommandInfo, value?: number) {
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

  // Group commands by entity
  $: groupedCommands = (() => {
    const groups = new Map<string, CommandInfo[]>();
    for (const cmd of availableCommands) {
      const key = cmd.entityId;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(cmd);
    }
    return groups;
  })();

  $: bridgeStatusState = (() => {
    if (infoError) return 'error';
    return bridgeInfo?.status ?? 'idle';
  })();

  $: currentBridgeStatusLabel = (() => {
    if (infoLoading) return '브리지 정보를 불러오는 중입니다...';
    if (infoError) return infoError;
    if (!bridgeInfo) return '브리지 정보가 없습니다.';
    return bridgeStatusLabels[bridgeInfo.status];
  })();
</script>

<main>
  <section class="panel viewer">
    <header class="viewer-header">
      <div>
        <p class="eyebrow">RS485 HomeNet to MQTT Bridge</p>
        <h1>Homenet2MQTT</h1>
      </div>
      <div class="controls">
        <button
          class="ghost"
          type="button"
          on:click={() => loadBridgeInfo(true)}
          disabled={infoLoading}
        >
          {infoLoading ? '갱신 중...' : '정보 새로고침'}
        </button>
      </div>
      <div class="status-column">
        <div class="status" data-state={bridgeStatusState}>
          <span class="dot" />
          <span>{currentBridgeStatusLabel}</span>
        </div>
        <div class="status" data-state={connectionStatus}>
          <span class="dot" />
          <span>{statusMessage || 'MQTT 스트림을 기다리는 중입니다.'}</span>
        </div>
      </div>
    </header>

    {#if infoLoading && !bridgeInfo && !infoError}
      <p class="hint">브리지 정보를 불러오는 중입니다...</p>
    {:else if infoError}
      <p class="error">{infoError}</p>
    {:else if !bridgeInfo}
      <p class="empty">브리지 정보가 없습니다.</p>
    {:else}
      <div class="viewer-meta">
        <div>
          <span class="label">Config File</span>
          <strong>{bridgeInfo.configFile || 'N/A'}</strong>
        </div>
        <div>
          <span class="label">Serial Path</span>
          <strong>{bridgeInfo.serialPath || '입력되지 않음'}</strong>
        </div>
        <div>
          <span class="label">Baud Rate</span>
          <strong>{bridgeInfo.baudRate}</strong>
        </div>
        <div>
          <span class="label">MQTT URL</span>
          <strong>{bridgeInfo.mqttUrl}</strong>
        </div>
      </div>

      {#if bridgeInfo.error}
        <p class="error subtle">브리지 오류: {bridgeInfo.error}</p>
      {/if}

      <div class="main-grid">
        <div class="column left">
          <h2>장치 상태</h2>
          <div class="state-cards">
            {#if deviceStates.size === 0}
              <p class="empty">아직 수신된 장치 상태가 없습니다.</p>
            {:else}
              {#each Array.from(deviceStates.entries()) as [topic, payload] (topic)}
                {#if !isBridgeStatusTopic(topic)}
                  {@const parsedPayload = parsePayload(payload)}
                  <article class="state-card" data-state={payload}>
                    <span class="topic">{formatTopicName(topic)}</span>
                    {#if parsedPayload}
                      <div class="payload-list">
                        {#each parsedPayload as entry (entry.key)}
                          <div class="payload-row">
                            <span class="payload-key">{entry.key}</span>
                            <span class="payload-value">{entry.value}</span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <strong class="payload">{payload}</strong>
                    {/if}
                  </article>
                {/if}
              {/each}
            {/if}
          </div>
        </div>

        <div class="column right">
          <!-- Command Buttons Section -->
          <div class="commands-container">
            <h2>명령 버튼</h2>
            {#if commandsLoading}
              <p class="empty">명령 목록을 불러오는 중입니다...</p>
            {:else if commandsError}
              <p class="error">{commandsError}</p>
            {:else if groupedCommands.size === 0}
              <p class="empty">사용 가능한 명령이 없습니다.</p>
            {:else}
              <div class="command-groups">
                {#each Array.from(groupedCommands.entries()) as [entityId, commands] (entityId)}
                  <div class="command-group">
                    <span class="entity-name">{commands[0].entityName}</span>
                    <div class="command-buttons">
                      {#each commands as cmd (cmd.commandName)}
                        {#if cmd.inputType === 'number'}
                          <div class="command-input-group">
                            <input
                              type="number"
                              min={cmd.min}
                              max={cmd.max}
                              step={cmd.step}
                              bind:value={temperatureInputs[`${cmd.entityId}_${cmd.commandName}`]}
                              class="temp-input"
                            />
                            <button
                              class="command-btn input-btn"
                              on:click={() =>
                                executeCommand(
                                  cmd,
                                  temperatureInputs[`${cmd.entityId}_${cmd.commandName}`],
                                )}
                              disabled={executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
                            >
                              {#if executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
                                ...
                              {:else}
                                {cmd.commandName.replace('command_', '')}
                              {/if}
                            </button>
                          </div>
                        {:else}
                          <button
                            class="command-btn"
                            class:on={cmd.commandName.includes('on') ||
                              cmd.commandName.includes('heat') ||
                              cmd.commandName.includes('open') ||
                              cmd.commandName.includes('unlock')}
                            class:off={cmd.commandName.includes('off') ||
                              cmd.commandName.includes('close') ||
                              cmd.commandName.includes('lock')}
                            on:click={() => executeCommand(cmd)}
                            disabled={executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
                          >
                            {#if executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
                              ...
                            {:else}
                              {cmd.commandName.replace('command_', '').toUpperCase()}
                            {/if}
                          </button>
                        {/if}
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Command Log Section -->
          <div class="command-log-container">
            <h2>명령 로그</h2>
            <div class="packet-list command-list">
              {#if commandPackets.length === 0}
                <p class="empty">아직 전송된 명령이 없습니다.</p>
              {:else}
                {#each [...commandPackets].reverse() as packet (packet.timestamp + packet.entity + packet.command)}
                  <div class="packet-line command-line">
                    <span class="time">[{new Date(packet.timestamp).toLocaleTimeString()}]</span>
                    <span class="entity">{packet.entity}</span>
                    <span class="command">{packet.command}</span>
                    <span class="value"
                      >{packet.value !== undefined ? `(${packet.value})` : ''}</span
                    >
                    <code class="payload">{toHexPairs(packet.packet).join(' ')}</code>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </div>

      <div class="stats-container">
        <h2>패킷 간격 분석</h2>
        <div class="viewer-meta stats-meta">
          {#if packetStats}
            <div>
              <span class="label">패킷 간격 (평균 ± 표준편차)</span>
              <strong>{packetStats.packetAvg} ± {packetStats.packetStdDev} ms</strong>
            </div>
            <div>
              <span class="label">유휴 간격 (평균 ± 표준편차)</span>
              <strong
                >{packetStats.idleAvg > 0
                  ? `${packetStats.idleAvg} ± ${packetStats.idleStdDev} ms`
                  : 'N/A'}</strong
              >
            </div>
            <div>
              <span class="label">유휴 발생 간격 (평균 ± 표준편차)</span>
              <strong
                >{packetStats.idleOccurrenceAvg > 0
                  ? `${packetStats.idleOccurrenceAvg} ± ${packetStats.idleOccurrenceStdDev} ms`
                  : 'N/A'}</strong
              >
            </div>
            <div>
              <span class="label">표본 크기</span>
              <strong>{packetStats.sampleSize}</strong>
            </div>
          {:else}
            <p class="empty">분석중입니다...</p>
          {/if}
        </div>
      </div>

      <div class="raw-title-container">
        <h2 class="raw-title">Raw 패킷 로그</h2>
        <button class="ghost" on:click={() => (isLogPaused = !isLogPaused)}>
          {isLogPaused ? '로그 이어보기' : '로그 일시정지'}
        </button>
      </div>
      <div class="packet-list">
        {#if rawPackets.length === 0}
          <p class="empty">아직 수신된 Raw 패킷이 없습니다.</p>
        {:else}
          {#each [...rawPackets].reverse() as packet (packet.receivedAt + packet.topic)}
            <div class="packet-line">
              <span class="time">[{new Date(packet.receivedAt).toLocaleTimeString()}]</span>
              <span class="interval"
                >{packet.interval !== null
                  ? `${packet.interval >= 0 ? '+' : ''}${packet.interval}ms`
                  : ''}</span
              >
              <code class="payload">{toHexPairs(packet.payload).join(' ')}</code>
            </div>
          {/each}
        {/if}
      </div>
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
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 2rem 1rem;
  }

  .panel {
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.4);
    padding: 2rem;
    border-radius: 1rem;
    box-shadow: 0 30px 60px rgba(15, 23, 42, 0.55);
  }

  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.8rem;
  }

  button {
    padding: 0.85rem 1.5rem;
    border-radius: 9999px;
    border: none;
    background: linear-gradient(135deg, #2563eb, #7c3aed);
    color: white;
    cursor: pointer;
    font-weight: 600;
    letter-spacing: 0.05em;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button:hover:enabled {
    transform: translateY(-1px);
    box-shadow: 0 12px 24px rgba(59, 130, 246, 0.35);
  }

  .ghost {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.4);
    color: #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.35rem 0.9rem;
    letter-spacing: 0;
    box-shadow: none;
  }

  .viewer {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 95vw;
    min-width: calc(min(1200px, 95vw));
    margin: 0 auto;
  }

  .viewer-header {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'title controls'
      'status status';
    align-items: start;
    gap: 1rem;
  }

  .viewer-header > div:first-child {
    grid-area: title;
  }

  .controls {
    grid-area: controls;
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .status-column {
    grid-area: status;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.75rem;
    color: rgba(226, 232, 240, 0.7);
    margin: 0 0 0.3rem;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.9rem;
    border-radius: 9999px;
    font-size: 0.85rem;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(15, 23, 42, 0.7);
  }

  .status .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 9999px;
    background: #cbd5f5;
  }

  .status[data-state='connected'] .dot,
  .status[data-state='started'] .dot {
    background: #34d399;
  }

  .status[data-state='starting'] .dot,
  .status[data-state='connecting'] .dot {
    background: #fcd34d;
  }

  .status[data-state='error'] .dot {
    background: #f87171;
  }

  .status[data-state='idle'] .dot,
  .status[data-state='stopped'] .dot {
    background: #94a3b8;
  }

  .hint {
    margin: 0;
    color: rgba(226, 232, 240, 0.7);
    text-align: center;
  }

  .error {
    color: #fca5a5;
    font-size: 0.95rem;
    margin: 0;
    text-align: center;
  }

  .error.subtle {
    text-align: left;
  }

  .viewer-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    padding: 1rem;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 0.75rem;
    background: rgba(15, 23, 42, 0.7);
  }

  .viewer-meta > div {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .viewer-meta .label,
  .viewer-meta strong {
    display: block;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .label {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: rgba(226, 232, 240, 0.6);
  }

  .state-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .state-card {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 0.75rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .state-card .topic {
    font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
    font-size: 0.85rem;
    color: rgba(226, 232, 240, 0.7);
  }

  .state-card .payload {
    font-size: 1rem;
    font-weight: 600;
    white-space: normal;
    word-wrap: break-word;
  }

  .payload-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .payload-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: rgba(226, 232, 240, 0.9);
  }

  .payload-key {
    font-size: 0.8rem;
    color: rgba(148, 163, 184, 0.9);
  }

  .payload-value {
    font-weight: 600;
    text-align: right;
    word-break: break-word;
    flex: 1;
  }

  .state-card[data-state='ON'] .payload {
    color: #a7f3d0;
  }

  .state-card[data-state='OFF'] .payload {
    color: #9ca3af;
  }

  .raw-title {
    font-size: 1rem;
    margin: 0;
    color: rgba(226, 232, 240, 0.8);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.3);
    flex-grow: 1;
  }

  .raw-title-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 2rem 0 0.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.3);
  }

  .raw-title-container h2 {
    border-bottom: none;
    margin: 0;
    padding-bottom: 0.5rem;
  }

  .packet-list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem; /* Reduced gap for line-based display */
    padding: 0.5rem;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.3);
  }

  .packet-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
    font-size: 0.8rem;
    color: #e2e8f0;
    line-height: 1.4;
    user-select: text; /* Ensure text is selectable */
  }

  .packet-line .time {
    color: rgba(226, 232, 240, 0.6);
    margin-right: 0.5rem;
    white-space: nowrap;
  }

  .packet-line .payload {
    flex-grow: 1;
    word-break: break-all;
    white-space: pre-wrap; /* Allow long lines to wrap */
    background: transparent; /* Remove background from code block */
    padding: 0; /* Remove padding from code block */
    border-radius: 0; /* Remove border-radius from code block */
  }

  code {
    /* Keep generic code styling, but make it less intrusive for .packet-line .payload */
    font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
    background: rgba(15, 23, 42, 0.9);
    padding: 0.5rem;
    border-radius: 0.5rem;
    display: block;
    overflow-x: auto;
  }

  .empty {
    text-align: center;
    color: rgba(226, 232, 240, 0.7);
    margin: 0.5rem 0;
  }

  @media (max-width: 720px) {
    .viewer-header {
      grid-template-columns: 1fr;
      grid-template-areas:
        'title'
        'controls'
        'status';
    }
  }

  .main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-top: 1.5rem;
  }

  @media (max-width: 900px) {
    .main-grid {
      grid-template-columns: 1fr;
    }
  }

  .column h2 {
    font-size: 1rem;
    margin: 0 0 1rem;
    color: rgba(226, 232, 240, 0.9);
    border-bottom: 1px solid rgba(148, 163, 184, 0.3);
    padding-bottom: 0.5rem;
  }

  .command-list {
    max-height: 500px;
    overflow-y: auto;
  }

  .command-line {
    display: grid;
    grid-template-columns: auto auto auto auto auto 1fr;
    gap: 0.5rem;
    align-items: center;
  }

  .command-line .entity {
    color: #60a5fa;
    font-weight: 600;
  }

  .command-line .command {
    color: #f472b6;
  }

  .command-line .value {
    color: #fbbf24;
  }

  .stats-container {
    margin-top: 2rem;
  }

  .stats-container h2 {
    font-size: 1rem;
    margin: 0 0 1rem;
    color: rgba(226, 232, 240, 0.9);
    border-bottom: 1px solid rgba(148, 163, 184, 0.3);
    padding-bottom: 0.5rem;
  }

  .stats-meta {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .packet-line {
    display: grid;
    grid-template-columns: auto auto auto auto auto 1fr;
    gap: 0.5rem;
    align-items: baseline;
  }

  .packet-line .interval {
    color: #a7f3d0;
    font-size: 0.75rem;
    width: 60px;
    text-align: right;
  }

  /* Command Buttons Styles */
  .commands-container {
    margin-bottom: 1rem;
  }
  /* 
  .commands-container h2 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
    color: rgba(226, 232, 240, 0.9);
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    padding-bottom: 0.25rem;
  }

  .command-log-container h2 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
    color: rgba(226, 232, 240, 0.9);
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    padding-bottom: 0.25rem;
  } */

  .command-groups {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .command-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    flex-wrap: wrap;
  }

  .command-group .entity-name {
    font-size: 0.8rem;
    color: #60a5fa;
    font-weight: 600;
    min-width: 100px;
    white-space: nowrap;
  }

  .command-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .command-btn {
    padding: 0 0.5rem;
    height: 24px;
    line-height: 20px;
    border-radius: 0.25rem;
    border: 1px solid rgba(148, 163, 184, 0.5);
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.7rem;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .command-btn:hover:enabled {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.8);
    color: #e2e8f0;
  }

  .command-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .command-btn.on {
    border-color: rgba(34, 197, 94, 0.7);
    color: #4ade80;
    background: transparent;
  }

  .command-btn.on:hover:enabled {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 1);
  }

  .command-btn.off {
    border-color: rgba(239, 68, 68, 0.7);
    color: #f87171;
    background: transparent;
  }

  .command-btn.off:hover:enabled {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 1);
  }

  .command-input-group {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .temp-input {
    width: 40px;
    height: 22px;
    padding: 0 0.25rem;
    border-radius: 0.25rem 0 0 0.25rem;
    border: 1px solid rgba(251, 191, 36, 0.5);
    border-right: none;
    background: transparent;
    color: #fbbf24;
    font-size: 0.7rem;
    font-weight: 600;
    text-align: center;
    line-height: 20px;
  }

  .temp-input:focus {
    outline: none;
    border-color: #fbbf24;
  }

  .command-btn.input-btn {
    border-radius: 0 0.25rem 0.25rem 0;
    border-color: rgba(251, 191, 36, 0.5);
    color: #fbbf24;
    background: transparent;
  }

  .command-btn.input-btn:hover:enabled {
    background: rgba(251, 191, 36, 0.15);
    border-color: rgba(251, 191, 36, 1);
  }
</style>
