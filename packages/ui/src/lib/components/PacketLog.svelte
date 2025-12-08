<script lang="ts">
  import type { CommandPacket, RawPacketWithInterval } from '../types';

  export let commandPackets: CommandPacket[] = [];
  export let rawPackets: RawPacketWithInterval[] = [];
  export let isLogPaused = false;
  export let togglePause: () => void;

  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];
</script>

<!-- Command Log Section -->
<div class="log-section">
  <h2>명령 로그</h2>
  <div class="log-list">
    {#if commandPackets.length === 0}
      <p class="empty">아직 전송된 명령이 없습니다.</p>
    {:else}
      {#each [...commandPackets].reverse() as packet (packet.timestamp + packet.entity + packet.command)}
        <div class="log-item command-item">
          <span class="time">[{new Date(packet.timestamp).toLocaleTimeString()}]</span>
          <span class="entity">{packet.entity}</span>
          <span class="command">{packet.command}</span>
          <span class="value">{packet.value !== undefined ? `(${packet.value})` : ''}</span>
          <code class="payload">{toHexPairs(packet.packet).join(' ')}</code>
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- Raw Packet Log -->
<div class="log-section">
  <div class="log-header">
    <h2>Raw 패킷 로그</h2>
    <button class="ghost-sm" on:click={togglePause}>
      {isLogPaused ? '▶ 로그 이어보기' : '⏸ 로그 일시정지'}
    </button>
  </div>
  <div class="log-list raw-list">
    {#if rawPackets.length === 0}
      <p class="empty">아직 수신된 Raw 패킷이 없습니다.</p>
    {:else}
      {#each [...rawPackets].reverse() as packet (packet.receivedAt + packet.topic)}
        <div class="log-item">
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
</div>

<style>
  .log-section {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.1rem;
    margin: 0;
    color: #e2e8f0;
  }

  .log-list {
    background: rgba(15, 23, 42, 0.5);
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.1);
    height: 400px;
    overflow-y: auto;
    padding: 0.5rem;
    font-family: monospace;
    font-size: 0.85rem;
  }

  .log-item {
    display: flex;
    gap: 0.75rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    align-items: center;
    color: #cbd5e1;
  }

  .log-item:last-child {
    border-bottom: none;
  }

  .time {
    color: #64748b;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .entity {
    color: #3b82f6;
    font-weight: 600;
  }

  .command {
    color: #a855f7;
  }

  .value {
    color: #ec4899;
  }

  .interval {
    color: #f59e0b;
    width: 60px;
    text-align: right;
    font-size: 0.8rem;
  }

  .payload {
    margin-left: auto;
    color: #10b981;
    font-weight: 600;
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: #64748b;
    font-style: italic;
  }

  .ghost-sm {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .ghost-sm:hover {
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
  }
</style>
