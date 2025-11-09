<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  type PacketEvent = {
    topic: string;
    payload: string;
    payloadHex: string;
    payloadLength: number;
    receivedAt: string;
  };

  type BridgeStatus = 'idle' | 'starting' | 'started' | 'error';

  type BridgeInfo = {
    serialPath: string;
    baudRate: number;
    mqttUrl: string;
    status: BridgeStatus;
    error?: string | null;
    topic: string;
  };

  const MAX_PACKETS = 100;
  const bridgeStatusLabels: Record<BridgeStatus, string> = {
    idle: '브리지를 준비하는 중입니다.',
    starting: '시리얼 장치를 찾는 중입니다.',
    started: '브리지가 실행 중입니다.',
    error: '브리지 오류가 발생했습니다.',
  };

  let bridgeInfo: BridgeInfo | null = null;
  let infoLoading = false;
  let infoError = '';
  let packets: PacketEvent[] = [];
  let eventSource: EventSource | null = null;
  let connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  let statusMessage = '';

  onMount(() => {
    loadBridgeInfo(true);
  });

  async function loadBridgeInfo(force = false) {
    if (infoLoading && !force) {
      return;
    }

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
      packets = [];
      startPacketStream();
    } catch (err) {
      bridgeInfo = null;
      closeStream();
      infoError = err instanceof Error ? err.message : '브리지 정보를 불러오지 못했습니다.';
    } finally {
      infoLoading = false;
    }
  }

  function startPacketStream() {
    if (typeof window === 'undefined' || !bridgeInfo) {
      return;
    }

    closeStream();

    connectionStatus = 'connecting';
    statusMessage = 'RS485 패킷 스트림을 연결하는 중입니다...';

    const url = new URL('/api/packets/stream', window.location.origin);
    if (bridgeInfo.mqttUrl.trim().length > 0) {
      url.searchParams.set('mqttUrl', bridgeInfo.mqttUrl.trim());
    }

    eventSource = new EventSource(url.toString());

    const handleStatus = (event: MessageEvent<string>) => {
      const data = safeParse<Record<string, unknown>>(event.data);
      if (!data) {
        return;
      }

      const state = data.state;
      if (state === 'connected') {
        connectionStatus = 'connected';
        statusMessage = '패킷 스트림 연결 완료';
      } else if (state === 'subscribed') {
        connectionStatus = 'connected';
        statusMessage = `'${data.topic}' 패킷 수신 중`;
      } else if (state === 'error') {
        connectionStatus = 'error';
        statusMessage =
          typeof data.message === 'string' ? data.message : '패킷 스트림 오류가 발생했습니다.';
      } else if (state === 'connecting') {
        connectionStatus = 'connecting';
        statusMessage = '패킷 스트림을 다시 연결하는 중입니다...';
      }
    };

    const handlePacket = (event: MessageEvent<string>) => {
      const data = safeParse<PacketEvent>(event.data);
      if (!data) {
        return;
      }

      packets = [...packets, data].slice(-MAX_PACKETS);
    };

    eventSource.addEventListener('status', handleStatus);
    eventSource.addEventListener('packet', handlePacket);
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
        if (code >= 32 && code <= 126) {
          return char;
        }

        if (char === '\n') {
          return '⏎';
        }

        if (char === '\r') {
          return '↵';
        }

        if (char === '\t') {
          return '⇥';
        }

        return '·';
      })
      .join('');

  const currentBridgeStatusLabel = () => {
    if (infoLoading) {
      return '브리지 정보를 불러오는 중입니다...';
    }

    if (infoError) {
      return infoError;
    }

    if (!bridgeInfo) {
      return '브리지 정보가 없습니다.';
    }

    return bridgeStatusLabels[bridgeInfo.status];
  };

  const bridgeStatusState = () => {
    if (infoError) {
      return 'error';
    }

    return bridgeInfo?.status ?? 'idle';
  };

  onDestroy(closeStream);
</script>

<main>
  <section class="panel viewer">
    <header class="viewer-header">
      <div>
        <p class="eyebrow">RS485 HomeNet Bridge</p>
        <h1>실시간 상태</h1>
      </div>
      <div class="status-column">
        <div class="status" data-state={bridgeStatusState()}>
          <span class="dot" />
          <span>{currentBridgeStatusLabel()}</span>
        </div>
        <div class="status" data-state={connectionStatus}>
          <span class="dot" />
          <span>{statusMessage || 'RS485 패킷을 기다리는 중입니다.'}</span>
        </div>
      </div>
      <button
        class="ghost"
        type="button"
        on:click={() => loadBridgeInfo(true)}
        disabled={infoLoading}
      >
        {infoLoading ? '정보 새로고침 중...' : '정보 새로고침'}
      </button>
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

      <div class="packet-list">
        {#if packets.length === 0}
          <p class="empty">아직 수신된 패킷이 없습니다.</p>
        {:else}
          {#each [...packets].reverse() as packet (packet.receivedAt + packet.payloadHex)}
            <article class="packet">
              <header>
                <span class="time">{new Date(packet.receivedAt).toLocaleTimeString()}</span>
                <span class="topic">{packet.topic}</span>
                <span class="length">{packet.payloadLength} bytes</span>
              </header>
              <div class="payload">
                <span>ASCII</span>
                <code>{toPrintableAscii(packet.payload)}</code>
              </div>
              <div class="payload">
                <span>HEX</span>
                <code>{packet.payloadHex.toUpperCase()}</code>
              </div>
              <div class="payload bytes">
                <span>RS485 Bytes</span>
                <div class="byte-grid">
                  {#each toHexPairs(packet.payloadHex) as byte, index}
                    <span class="byte" title={`byte ${index}`}>{byte}</span>
                  {/each}
                </div>
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

  .viewer {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .viewer-header {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 1rem;
  }

  .status-column {
    display: flex;
    flex-direction: column;
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

  .status[data-state='connected'] .dot {
    background: #34d399;
  }

  .status[data-state='starting'] .dot,
  .status[data-state='connecting'] .dot {
    background: #fcd34d;
  }

  .status[data-state='error'] .dot {
    background: #f87171;
  }

  .status[data-state='idle'] .dot {
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
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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

  .payload span {
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    color: rgba(226, 232, 240, 0.7);
  }

  code {
    font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
    background: rgba(15, 23, 42, 0.9);
    padding: 0.5rem;
    border-radius: 0.5rem;
    display: block;
    overflow-x: auto;
  }

  .payload.bytes .byte-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(48px, 1fr));
    gap: 0.35rem;
  }

  .byte {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    padding: 0.3rem;
    background: rgba(148, 163, 184, 0.1);
    border-radius: 0.4rem;
    font-size: 0.8rem;
    font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
  }

  .empty {
    text-align: center;
    color: rgba(226, 232, 240, 0.7);
    margin: 0.5rem 0;
  }

  @media (max-width: 720px) {
    .viewer-header {
      grid-template-columns: 1fr;
    }

    .status-column {
      flex-direction: column;
    }

    button {
      justify-self: start;
    }
  }
</style>
