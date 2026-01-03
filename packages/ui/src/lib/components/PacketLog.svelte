<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { CommandPacket, ParsedPacket } from '../types';
  import VirtualList from '@humanspeak/svelte-virtual-list';

  let { parsedPackets = [], commandPackets = [] } = $props<{
    parsedPackets?: ParsedPacket[];
    commandPackets?: CommandPacket[];
  }>();

  let showRx = $state(true);
  let showTx = $state(true);
  let searchQuery = $state('');
  let debouncedQuery = $state('');
  const SEARCH_DEBOUNCE_MS = 200;
  let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  type MergedPacket = ({ type: 'rx' } & ParsedPacket) | ({ type: 'tx' } & CommandPacket);

  const getTimestampMs = (packet: ParsedPacket | CommandPacket) =>
    packet.timestampMs ?? new Date(packet.timestamp).getTime();

  const mergePackets = (rxPackets: ParsedPacket[], txPackets: CommandPacket[]) => {
    const merged: MergedPacket[] = [];
    let rxIndex = 0;
    let txIndex = 0;

    while (rxIndex < rxPackets.length || txIndex < txPackets.length) {
      const rxPacket = rxPackets[rxIndex];
      const txPacket = txPackets[txIndex];
      const rxTimestamp = rxPacket ? getTimestampMs(rxPacket) : -Infinity;
      const txTimestamp = txPacket ? getTimestampMs(txPacket) : -Infinity;

      if (txPacket === undefined || (rxPacket && rxTimestamp >= txTimestamp)) {
        merged.push({ ...rxPacket, type: 'rx' } as const);
        rxIndex += 1;
      } else if (txPacket) {
        merged.push({ ...txPacket, type: 'tx' } as const);
        txIndex += 1;
      }
    }

    return merged;
  };

  $effect(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (searchDebounceHandle) {
      clearTimeout(searchDebounceHandle);
    }

    searchDebounceHandle = setTimeout(() => {
      debouncedQuery = normalizedQuery;
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchDebounceHandle) {
        clearTimeout(searchDebounceHandle);
      }
    };
  });

  const mergedPackets = $derived.by(() => {
    const query = debouncedQuery;
    const rxPackets = showRx ? parsedPackets : [];
    const txPackets = showTx ? commandPackets : [];
    const filteredRx = query
      ? rxPackets.filter((packet: ParsedPacket) => packet.searchText?.includes(query))
      : rxPackets;
    const filteredTx = query
      ? txPackets.filter((packet: CommandPacket) => packet.searchText?.includes(query))
      : txPackets;

    return mergePackets(filteredRx, filteredTx);
  });
</script>

{#snippet renderPacketItem(packet: MergedPacket, _index: number)}
  <div class="log-item {packet.type}">
    <span class="time">[{packet.timeLabel ?? new Date(packet.timestamp).toLocaleTimeString()}]</span
    >

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
{/snippet}

<!-- Unified Packet Log Section -->
<div class="log-section">
  <div class="log-header">
    <div class="header-left">
      <h2>{$t('analysis.packet_log.title')}</h2>
      <div class="filters">
        <div class="search-box">
          <input
            type="text"
            bind:value={searchQuery}
            placeholder={$t('analysis.packet_log.search_placeholder')}
            aria-label={$t('analysis.packet_log.search_placeholder')}
          />
        </div>
        <label>
          <input type="checkbox" bind:checked={showRx} />
          {$t('analysis.packet_log.rx')}
        </label>
        <label>
          <input type="checkbox" bind:checked={showTx} />
          {$t('analysis.packet_log.tx')}
        </label>
      </div>
    </div>
  </div>
  <p class="description">{$t('analysis.packet_log.desc')}</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="log-list unified-list"
    tabindex="0"
    role="log"
    aria-label={$t('analysis.packet_log.title')}
  >
    {#if mergedPackets.length === 0}
      <p class="empty">{$t('analysis.packet_log.empty')}</p>
    {:else}
      <VirtualList
        items={mergedPackets}
        renderItem={renderPacketItem}
        defaultEstimatedItemHeight={32}
        bufferSize={10}
      />
    {/if}
  </div>
</div>

<style>
  .log-section {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
  }

  @media (max-width: 480px) {
    .log-section {
      padding: 0.75rem;
      border-radius: 8px;
    }
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
    flex-wrap: wrap; /* Handle small screens */
  }

  .description {
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .filters {
    display: flex;
    gap: 1rem;
    align-items: center;
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .search-box input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    color: #e2e8f0;
    font-size: 0.85rem;
    width: 200px;
  }

  .search-box input:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .filters label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
  }

  .filters input[type='checkbox'] {
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
    padding: 0.5rem;
    overflow: hidden;
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

  @media (max-width: 480px) {
    .log-item {
      gap: 0.5rem;
      padding: 0.4rem 0.3rem;
    }
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
