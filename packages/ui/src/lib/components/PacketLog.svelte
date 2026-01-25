<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { CommandLogEntry, PacketLogEntry } from '../types';
  import VirtualList from '@humanspeak/svelte-virtual-list';
  import { formatTime } from '../utils/time';

  let {
    parsedLogs = [],
    commandLogs = [],
    packetDictionary = {},
  } = $props<{
    parsedLogs?: PacketLogEntry[];
    commandLogs?: CommandLogEntry[];
    packetDictionary?: Record<string, string>;
  }>();

  let showRx = $state(true);
  let showTx = $state(true);
  let isPaused = $state(false);
  let searchQuery = $state('');
  let debouncedQuery = $state('');
  const SEARCH_DEBOUNCE_MS = 200;
  let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  type MergedPacket = { type: 'rx'; data: PacketLogEntry } | { type: 'tx'; data: CommandLogEntry };

  const getTimestampMs = (packet: PacketLogEntry | CommandLogEntry) =>
    packet.timestampMs ?? new Date(packet.timestamp).getTime();

  const mergePackets = (rxPackets: PacketLogEntry[], txPackets: CommandLogEntry[]) => {
    // Snapshot or use raw arrays to avoid excessive proxy overhead if passed as proxies
    // However, since we just iterate and push to a new array, the overhead is mainly in property access.
    // If the arrays are huge, using $state.snapshot might be better, but let's first rely on the logic change.
    const merged: MergedPacket[] = [];
    let rxIndex = 0;
    let txIndex = 0;

    const rxLen = rxPackets.length;
    const txLen = txPackets.length;

    while (rxIndex < rxLen || txIndex < txLen) {
      const rxPacket = rxPackets[rxIndex];
      const txPacket = txPackets[txIndex];
      const rxTimestamp = rxPacket ? getTimestampMs(rxPacket) : -Infinity;
      const txTimestamp = txPacket ? getTimestampMs(txPacket) : -Infinity;

      if (txPacket === undefined || (rxPacket && rxTimestamp >= txTimestamp)) {
        merged.push({ type: 'rx', data: rxPacket });
        rxIndex += 1;
      } else if (txPacket) {
        merged.push({ type: 'tx', data: txPacket });
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

  // Calculate merged logs normally
  const displayPackets = $derived.by(() => {
    const query = debouncedQuery;
    const rxPackets = showRx ? parsedLogs : [];
    const txPackets = showTx ? commandLogs : [];

    // Use searchText pre-calculated in logs for filtering
    const filteredRx = query
      ? rxPackets.filter((packet: PacketLogEntry) => packet.searchText?.includes(query))
      : rxPackets;
    const filteredTx = query
      ? txPackets.filter((packet: CommandLogEntry) => packet.searchText?.includes(query))
      : txPackets;

    return mergePackets(filteredRx, filteredTx);
  });

  // When not paused, sync viewPackets with displayPackets
  // When paused, viewPackets remains properly frozen
  let viewPackets = $state<MergedPacket[]>([]);

  $effect(() => {
    if (!isPaused) {
      viewPackets = displayPackets;
    }
  });
</script>

{#snippet renderPacketItem(packet: MergedPacket, _index: number)}
  <div class="log-item {packet.type}">
    <span class="time">[{packet.data.timeLabel ?? formatTime(packet.data.timestamp)}]</span>

    {#if packet.type === 'rx'}
      <span class="direction rx">RX</span>
      <span class="entity">{packet.data.entityId}</span>
      <span class="payload">{(packetDictionary[packet.data.packetId] || '').toUpperCase()}</span>
      {#if (packet.data as PacketLogEntry).state}
        <span class="state-preview">→ {JSON.stringify((packet.data as PacketLogEntry).state)}</span>
      {/if}
    {:else}
      <span class="direction tx">TX</span>
      <span class="entity">{packet.data.entityId}</span>
      <span class="payload">{(packetDictionary[packet.data.packetId] || '').toUpperCase()}</span>
      <span class="command-info">
        {(packet.data as CommandLogEntry).command}
        {#if (packet.data as CommandLogEntry).value !== undefined}<span class="value"
            >({(packet.data as CommandLogEntry).value})</span
          >{/if}
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
        <button
          type="button"
          class="filter-chip"
          class:active={showRx}
          aria-pressed={showRx}
          onclick={() => (showRx = !showRx)}
        >
          {$t('analysis.packet_log.rx')}
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={showTx}
          aria-pressed={showTx}
          onclick={() => (showTx = !showTx)}
        >
          {$t('analysis.packet_log.tx')}
        </button>
      </div>
    </div>

    <div class="header-right">
      <button
        class="pause-btn"
        class:paused={isPaused}
        onclick={() => (isPaused = !isPaused)}
        title={isPaused ? $t('common.resume') : $t('common.pause')}
      >
        {#if isPaused}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="16"
            height="16"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          {$t('common.resume', { default: 'Resume' })}
        {:else}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="16"
            height="16"
          >
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
          {$t('common.pause', { default: 'Pause' })}
        {/if}
      </button>
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
    {#if viewPackets.length === 0}
      <p class="empty">{$t('analysis.packet_log.empty')}</p>
    {:else}
      <VirtualList
        items={viewPackets}
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
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap; /* Handle small screens */
    flex: 1 1 320px;
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
    flex-wrap: wrap;
  }

  .search-box {
    flex: 1 1 200px;
  }

  .search-box input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    color: #e2e8f0;
    font-size: 0.85rem;
    width: 100%;
  }

  .search-box input:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .filter-chip {
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 999px;
    padding: 0.3rem 0.65rem;
    background: rgba(15, 23, 42, 0.6);
    color: #cbd5f5;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .filter-chip:hover {
    border-color: rgba(148, 163, 184, 0.6);
    color: #e2e8f0;
  }

  .filter-chip.active {
    border-color: rgba(59, 130, 246, 0.7);
    background: rgba(59, 130, 246, 0.2);
    color: #eff6ff;
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.2);
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

  /* Right-side actions */
  .header-right {
    display: flex;
    align-items: center;
  }

  @media (max-width: 600px) {
    .header-right {
      width: 100%;
      justify-content: flex-end;
    }
  }

  .pause-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .pause-btn:hover {
    background: rgba(30, 41, 59, 0.8);
    border-color: rgba(148, 163, 184, 0.4);
  }

  .pause-btn.paused {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
    color: #fbbf24;
  }

  .pause-btn.paused:hover {
    background: rgba(245, 158, 11, 0.25);
  }

  .pause-btn svg {
    flex-shrink: 0;
  }
</style>
