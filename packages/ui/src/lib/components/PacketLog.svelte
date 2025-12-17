<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { CommandPacket, ParsedPacket } from '../types';

  let { parsedPackets = [], commandPackets = [] } = $props<{
    parsedPackets?: ParsedPacket[];
    commandPackets?: CommandPacket[];
  }>();

  let showRx = $state(true);
  let showTx = $state(true);

  type MergedPacket = ({ type: 'rx' } & ParsedPacket) | ({ type: 'tx' } & CommandPacket);

  const mergedPackets = $derived.by(() => {
    let packets: MergedPacket[] = [];

    if (showRx) {
      packets = packets.concat(
        parsedPackets.map((p: ParsedPacket) => ({ ...p, type: 'rx' }) as const),
      );
    }
    if (showTx) {
      packets = packets.concat(
        commandPackets.map((p: CommandPacket) => ({ ...p, type: 'tx' }) as const),
      );
    }

    return packets.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  });
</script>

<!-- Unified Packet Log Section -->
<div class="log-section">
  <div class="log-header">
    <div class="header-left">
      <h2>{$t('analysis.packet_log.title')}</h2>
      <div class="filters">
        <label>
          <input type="checkbox" bind:checked={showRx} /> {$t('analysis.packet_log.rx')}
        </label>
        <label>
          <input type="checkbox" bind:checked={showTx} /> {$t('analysis.packet_log.tx')}
        </label>
      </div>
    </div>
  </div>
  <p class="description">{$t('analysis.packet_log.desc')}</p>
  <div class="log-list unified-list">
    {#if mergedPackets.length === 0}
      <p class="empty">{$t('analysis.packet_log.empty')}</p>
    {:else}
      {#each mergedPackets as packet, index (`${packet.type}-${packet.timestamp}-${index}`)}
        <div class="log-item {packet.type}">
          <span class="time">[{new Date(packet.timestamp).toLocaleTimeString()}]</span>

          {#if packet.type === 'rx'}
            <span class="direction rx">RX</span>
            <span class="entity">{packet.entityId}</span>
            <span class="payload">{packet.packet.toUpperCase()}</span>
            {#if packet.state}
              <span class="state-preview">→ {JSON.stringify(packet.state)}</span>
            {/if}
          {:else}
            <span class="direction tx">TX</span>
            <span class="entity">{packet.entityId}</span>
            <span class="payload">{packet.packet.toUpperCase()}</span>
            <span class="command-info">
              {packet.command}
              {#if packet.value !== undefined}<span class="value">({packet.value})</span>{/if}
            </span>
          {/if}
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

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .description {
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .filters {
    display: flex;
    gap: 1rem;
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .filters label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
  }

  .filters input {
    cursor: pointer;
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

  .direction {
    font-weight: bold;
    font-size: 0.75rem;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    width: 24px;
    text-align: center;
  }

  .direction.rx {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .direction.tx {
    background: rgba(245, 158, 11, 0.2);
    color: #f59e0b;
  }

  .entity {
    color: #3b82f6;
    font-weight: 600;
  }

  .payload {
    color: #10b981;
    font-weight: 600;
    font-family: monospace;
  }

  .command-info {
    color: #a855f7;
    margin-left: 0.5rem;
  }

  .value {
    color: #ec4899;
  }

  .state-preview {
    color: #38bdf8;
    font-size: 0.85em;
    margin-left: 0.5rem;
    opacity: 0.9;
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: #64748b;
    font-style: italic;
  }
</style>
