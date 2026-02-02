<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { CommandLogEntry, PacketLogEntry } from '../types';
  import VirtualList from '@humanspeak/svelte-virtual-list';
  import { formatTime } from '../utils/time';
  import { fade } from 'svelte/transition';
  import Button from './Button.svelte';

  let {
    parsedLogs = [],
    commandLogs = [],
    packetDictionary = {},
    version = 0,
  } = $props<{
    parsedLogs?: PacketLogEntry[];
    commandLogs?: CommandLogEntry[];
    packetDictionary?: Record<string, string>;
    version?: number;
  }>();

  let showRx = $state(true);
  let showTx = $state(true);
  let isPaused = $state(false);
  let searchQuery = $state('');
  let debouncedQuery = $state('');
  const SEARCH_DEBOUNCE_MS = 300;
  let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  type MergedPacket = { type: 'rx'; data: PacketLogEntry } | { type: 'tx'; data: CommandLogEntry };

  const getTimestampMs = (packet: PacketLogEntry | CommandLogEntry) =>
    packet.timestampMs ?? new Date(packet.timestamp).getTime();

  const mergePackets = (rxPackets: PacketLogEntry[], txPackets: CommandLogEntry[]) => {
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

  function getSearchPattern(filter: string) {
    if (!filter) return null;
    const parts = filter.split(/(\*+)/);
    const patternParts = parts.reduce((acc, part) => {
      if (!part) return acc;
      if (part.startsWith('*')) {
        acc.push('.*?');
      } else {
        const searchChars = part.split('').filter((char) => char.trim().length > 0);
        const mappedChars = searchChars.map((char) => {
          if (char === '?') return '.';
          return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });
        if (mappedChars.length > 0) {
          acc.push(mappedChars.join('\\s*'));
        }
      }
      return acc;
    }, [] as string[]);
    if (patternParts.length === 0) return null;
    return `(${patternParts.join('')})`;
  }

  function getHighlightedParts(text: string, filter: string) {
    if (!filter) return [{ text, highlight: false }];
    const pattern = getSearchPattern(filter);
    if (!pattern) return [{ text, highlight: false }];
    const regex = new RegExp(pattern, 'gi');
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), highlight: false });
      }
      parts.push({ text: match[0], highlight: true });
      lastIndex = regex.lastIndex;
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), highlight: false });
    }
    return parts;
  }

  const normalizedFilter = $derived(debouncedQuery);

  // Calculate merged logs normally
  const displayPackets = $derived.by(() => {
    const query = debouncedQuery;
    // v is a dependency to trigger update when non-reactive arrays change
    const v = version;
    const rxPackets = showRx ? parsedLogs : [];
    const txPackets = showTx ? commandLogs : [];

    const filteredRx = query
      ? rxPackets.filter((packet: PacketLogEntry) => packet.searchText?.includes(query))
      : rxPackets;
    const filteredTx = query
      ? txPackets.filter((packet: CommandLogEntry) => packet.searchText?.includes(query))
      : txPackets;

    return mergePackets(filteredRx, filteredTx);
  });

  let viewPackets = $state<MergedPacket[]>([]);

  $effect(() => {
    if (!isPaused) {
      viewPackets = displayPackets;
    }
  });

  const getPayloadText = (packetId: string) => (packetDictionary[packetId] || '').toUpperCase();

  let copiedPacket = $state<string | null>(null);
  let copyTimeout: ReturnType<typeof setTimeout>;

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      throw new Error('Clipboard API unavailable');
    } catch (err) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.position = 'fixed';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
      } catch (fallbackErr) {
        console.error('Failed to copy', err, fallbackErr);
        return false;
      }
    }
  }

  async function copyPacket(packet: string) {
    const success = await copyToClipboard(packet);
    if (success) {
      copiedPacket = packet;

      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copiedPacket = null;
      }, 2000);
    }
  }
</script>

{#snippet renderPacketItem(packet: MergedPacket, _index: number)}
  <div class="log-item {packet.type}">
    <div class="log-meta">
      <span class="time">[{packet.data.timeLabel ?? formatTime(packet.data.timestamp)}]</span>
      <span class="direction {packet.type}">{packet.type.toUpperCase()}</span>
    </div>

    <div class="log-content">
      <div class="log-row primary">
        <span class="entity">
          {#each getHighlightedParts(packet.data.entityId, normalizedFilter) as part, index (`ent-${index}`)}
            {#if part.highlight}<mark>{part.text}</mark>{:else}{part.text}{/if}
          {/each}
        </span>
        <div class="code-wrapper">
          <code class="payload">
            {#each getHighlightedParts(getPayloadText(packet.data.packetId), normalizedFilter) as part, index (`pay-${index}`)}
              {#if part.highlight}<mark>{part.text}</mark>{:else}{part.text}{/if}
            {/each}
          </code>
          <button
            class="copy-btn"
            onclick={() => copyPacket(getPayloadText(packet.data.packetId))}
            aria-label={$t('common.copy')}
            title={$t('common.copy')}
          >
            {#if copiedPacket === getPayloadText(packet.data.packetId)}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="success-icon"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            {/if}
          </button>
        </div>
      </div>

      <div class="log-row secondary">
        {#if packet.type === 'rx'}
          {#if (packet.data as PacketLogEntry).state}
            <span class="state-preview"
              >→ {JSON.stringify((packet.data as PacketLogEntry).state)}</span
            >
          {/if}
        {:else}
          <span class="command-info">
            {#each getHighlightedParts((packet.data as CommandLogEntry).command, normalizedFilter) as part, index (`cmd-${index}`)}
              {#if part.highlight}<mark>{part.text}</mark>{:else}{part.text}{/if}
            {/each}
            {#if (packet.data as CommandLogEntry).value !== undefined}
              <span class="value">
                ({#each getHighlightedParts(String((packet.data as CommandLogEntry).value), normalizedFilter) as part, index (`val-${index}`)}
                  {#if part.highlight}<mark>{part.text}</mark>{:else}{part.text}{/if}
                {/each})
              </span>
            {/if}
          </span>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

<div id="packet-log" class="log-section">
  <div class="log-header">
    <div class="header-left">
      <h2>{$t('analysis.packet_log.title')}</h2>
    </div>
  </div>

  <p class="description">{$t('analysis.packet_log.desc')}</p>

  <div class="filter-row">
    <label class="filter-label">
      <span>{$t('analysis.packet_log.search_placeholder')}</span>
      <div class="search-input-wrapper">
        <input
          type="text"
          placeholder={$t('analysis.packet_log.search_placeholder')}
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button
            class="clear-search-btn"
            onclick={() => (searchQuery = '')}
            aria-label={$t('analysis.raw_log.clear_filter') || 'Clear search'}
            title={$t('analysis.raw_log.clear_filter') || 'Clear search'}
          >
            ×
          </button>
        {/if}
      </div>
    </label>
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

  <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-bottom: 0.5rem;">
    <Button variant="secondary" onclick={() => (isPaused = !isPaused)}>
      {#if isPaused}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          width="16"
          height="16"
          style="margin-right: 0.4rem;"
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
          style="margin-right: 0.4rem;"
        >
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
        {$t('common.pause', { default: 'Pause' })}
      {/if}
    </Button>
  </div>

  <div class="log-list unified-list" role="log" aria-label={$t('analysis.packet_log.title')}>
    {#if viewPackets.length === 0}
      <p class="empty">{$t('analysis.packet_log.empty')}</p>
    {:else}
      <VirtualList
        items={viewPackets}
        renderItem={renderPacketItem}
        defaultEstimatedItemHeight={52}
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
    gap: 1rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  h2 {
    font-size: 1.1rem;
    margin: 0;
    color: #e2e8f0;
  }

  .description {
    color: #94a3b8;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .filter-row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    margin: 0.75rem 0 1rem;
    flex-wrap: wrap;
  }

  .filter-label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
    min-width: 200px;
  }

  .filter-label span {
    font-size: 0.75rem;
    color: #94a3b8;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .search-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }

  .filter-label input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.9rem;
    transition: all 0.2s;
    width: 100%;
    box-sizing: border-box;
  }

  .filter-label input:focus {
    outline: none;
    border-color: #3b82f6;
    background: rgba(15, 23, 42, 0.8);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .clear-search-btn {
    position: absolute;
    right: 0.5rem;
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
    padding: 0;
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .clear-search-btn:hover {
    color: #e2e8f0;
    background: rgba(148, 163, 184, 0.2);
  }

  .filter-chip {
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 999px;
    padding: 0.4rem 0.9rem;
    background: rgba(15, 23, 42, 0.6);
    color: #cbd5e1;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    height: 38px;
    display: flex;
    align-items: center;
  }

  .filter-chip:hover {
    border-color: rgba(148, 163, 184, 0.6);
    color: #e2e8f0;
    background: rgba(30, 41, 59, 0.6);
  }

  .filter-chip.active {
    border-color: rgba(59, 130, 246, 0.6);
    background: rgba(59, 130, 246, 0.15);
    color: #eff6ff;
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.15);
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
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.25rem 0.6rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    color: #cbd5e1;
    min-height: 52px;
  }

  .log-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
    padding-top: 0.1rem;
  }

  .log-content {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .log-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 24px;
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
    font-size: 0.7rem;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    text-align: center;
    min-width: 28px;
  }

  .direction.rx {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }

  .direction.tx {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
  }

  .entity {
    color: #3b82f6;
    font-weight: 600;
  }

  .payload {
    color: #10b981;
    font-weight: 600;
    background: rgba(16, 185, 129, 0.05);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }

  .code-wrapper {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .copy-btn {
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .copy-btn:hover {
    color: #e2e8f0;
    background: rgba(148, 163, 184, 0.1);
  }

  .success-icon {
    color: #34d399;
  }

  .command-info {
    color: #a855f7;
    margin-left: 0.25rem;
  }

  .value {
    color: #ec4899;
  }

  .state-preview {
    color: #38bdf8;
    font-size: 0.85em;
    opacity: 0.9;
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: #64748b;
    font-style: italic;
  }

  mark {
    background: rgba(250, 204, 21, 0.3);
    color: #fde047;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
