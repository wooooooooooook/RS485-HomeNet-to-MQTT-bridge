<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  type MqttMessageEvent = {
    topic: string;
    payload: string;
    receivedAt: string;
  };

  type BridgeStatus = 'idle' | 'starting' | 'started' | 'stopped' | 'error';

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
  let rawPackets: MqttMessageEvent[] = [];
  let deviceStates = new Map<string, string>();
  let eventSource: EventSource | null = null;
  let connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  let statusMessage = '';
  let isLogPaused = false;

  let configFiles: string[] = [];
  let selectedConfigFile: string | null = null;
  let isSwitchingConfig = false;

  onMount(() => {
    loadBridgeInfo(true);
    loadConfigFiles();
  });

  async function loadConfigFiles() {
    try {
      const response = await fetch('/api/configs');
      if (!response.ok) {
        throw new Error('설정 파일 목록을 불러오지 못했습니다.');
      }
      configFiles = await response.json();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleConfigChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const file = target.value;
    if (!file || isSwitchingConfig) return;

    isSwitchingConfig = true;
    infoError = '';
    try {
      const response = await fetch('/api/configs/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '설정 변경에 실패했습니다.');
      }
      setTimeout(() => loadBridgeInfo(true), 1000);
    } catch (err) {
      infoError = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
    } finally {
      isSwitchingConfig = false;
    }
  }

  async function loadBridgeInfo(force = false) {
    if (infoLoading && !force) return;

    infoLoading = true;
    infoError = '';

    try {
      const response = await fetch('/api/bridge/info');

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || '브리지 정보를 가져오지 못했습니다.');
      }

      const data = (await response.json()) as BridgeInfo;

      bridgeInfo = data;
      selectedConfigFile = data.configFile;
      rawPackets = [];
      deviceStates.clear();
      startMqttStream();
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

    const url = new URL('/api/packets/stream', window.location.origin);
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

      if (data.topic === 'homenet/raw') {
        if (!isLogPaused) {
          rawPackets = [...rawPackets, data].slice(-MAX_PACKETS);
        }
      } else {
        deviceStates.set(data.topic, data.payload);
        deviceStates = deviceStates; // Trigger Svelte reactivity
      }
    };

    eventSource.addEventListener('status', handleStatus);
    eventSource.addEventListener('mqtt-message', handleMqttMessage);
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
  }

  function safeParse<T>(value: string): T | null {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];

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

  $: bridgeStatusState = (() => {
    if (infoError || isSwitchingConfig) return 'error';
    return bridgeInfo?.status ?? 'idle';
  })();

  $: currentBridgeStatusLabel = (() => {
    if (isSwitchingConfig) return '설정을 변경하는 중입니다...';
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
        <p class="eyebrow">RS485 HomeNet Bridge</p>
        <h1>실시간 상태</h1>
      </div>
      <div class="controls">
        <div class="control-group">
          <label for="config-selector">설정 파일</label>
          <select
            id="config-selector"
            bind:value={selectedConfigFile}
            on:change={handleConfigChange}
            disabled={isSwitchingConfig || configFiles.length === 0}
          >
            {#if configFiles.length > 0}
              {#each configFiles as file (file)}
                <option value={file}>{file}</option>
              {/each}
            {:else}
              <option disabled>불러오는 중...</option>
            {/if}
          </select>
        </div>
        <button
          class="ghost"
          type="button"
          on:click={() => loadBridgeInfo(true)}
          disabled={infoLoading || isSwitchingConfig}
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

      <div class="state-cards">
        {#if deviceStates.size === 0}
          <p class="empty">아직 수신된 장치 상태가 없습니다.</p>
        {:else}
          {#each Array.from(deviceStates.entries()) as [topic, payload] (topic)}
            <article class="state-card" data-state={payload}>
              <span class="topic">{topic.replace('homenet/', '')}</span>
              <strong class="payload">{payload}</strong>
            </article>
          {/each}
        {/if}
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
            <article class="packet">
              <header>
                <span class="time">{new Date(packet.receivedAt).toLocaleTimeString()}</span>
                <span class="topic">{packet.topic}</span>
              </header>
              <div class="payload">
                <code>{toHexPairs(packet.payload).join(' ')}</code>
              </div>
            </article>
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

  main {
    width: min(960px, 100%);
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

  select {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.4);
    color: #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.35rem 0.9rem;
    font-size: 0.9rem;
  }

  select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .viewer {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .control-group label {
    font-size: 0.75rem;
    color: rgba(226, 232, 240, 0.7);
    padding-left: 0.5rem;
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
    gap: 1rem;
  }

  .packet {
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 0.75rem;
    padding: 1rem;
    background: rgba(15, 23, 42, 0.6);
  }

  .packet header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    font-size: 0.85rem;
    color: rgba(226, 232, 240, 0.7);
    margin-bottom: 0.75rem;
  }

  .packet .topic {
    font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
    background: rgba(148, 163, 184, 0.15);
    padding: 0.15rem 0.4rem;
    border-radius: 0.35rem;
  }

  .payload {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  code {
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
</style>
