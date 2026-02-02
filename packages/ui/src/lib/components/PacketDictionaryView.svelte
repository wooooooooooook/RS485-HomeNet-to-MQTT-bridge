<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { PacketDictionaryFullResponse } from '../types';
  import { fade } from 'svelte/transition';
  import Button from './Button.svelte';

  let { portId = null }: { portId?: string | null } = $props();

  let data = $state<PacketDictionaryFullResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let viewMode = $state<'parsed' | 'unmatched' | 'all'>('all');
  let sortDesc = $state(false);

  async function fetchData() {
    loading = true;
    error = null;
    try {
      const url = portId
        ? `./api/packets/dictionary/full?portId=${encodeURIComponent(portId)}`
        : './api/packets/dictionary/full';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      data = await response.json();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  // Fetch on mount and when portId changes
  $effect(() => {
    // Reading portId to track changes
    const _portId = portId;
    fetchData();
  });

  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];

  const parsedPackets = $derived.by(() => {
    if (!data) return [];
    return Object.values(data.dictionary).map((hex) => hex.toUpperCase());
  });

  const unmatchedPackets = $derived.by(() => {
    if (!data) return [];
    return data.unmatchedPackets.map((hex) => hex.toUpperCase());
  });

  const displayPackets = $derived.by(() => {
    let packets: string[] = [];
    if (viewMode === 'parsed') {
      packets = parsedPackets;
    } else if (viewMode === 'unmatched') {
      packets = unmatchedPackets;
    } else {
      // 'all' mode - combine and deduplicate
      packets = Array.from(new Set([...parsedPackets, ...unmatchedPackets]));
    }

    packets.sort((a, b) => {
      const res = a.localeCompare(b);
      return sortDesc ? -res : res;
    });

    return packets;
  });

  const parsedSet = $derived.by(() => new Set(parsedPackets));

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

  let copySuccess = $state(false);

  async function copyAllPackets() {
    if (!data) return;

    const lines: string[] = [];

    // 통계 정보
    lines.push(
      `[Packet Dictionary - ${viewMode === 'all' ? 'All' : viewMode === 'parsed' ? 'Matched' : 'Unmatched'}]`,
    );
    lines.push(`Matched: ${parsedPackets.length}, Unmatched: ${unmatchedPackets.length}`);
    lines.push('');

    // 패킷 목록
    for (const packet of displayPackets) {
      const entities = data.parsedPacketEntities[packet.toLowerCase()] || [];
      const isParsed = parsedSet.has(packet);
      const badge = isParsed ? '[Matched]' : '[Unmatched]';
      const hexFormatted = toHexPairs(packet).join(' ');
      const entityInfo = entities.length > 0 ? ` → ${entities.join(', ')}` : '';
      lines.push(`${badge} ${hexFormatted}${entityInfo}`);
    }

    const success = await copyToClipboard(lines.join('\n'));
    if (success) {
      copySuccess = true;
      setTimeout(() => {
        copySuccess = false;
      }, 2000);
    }
  }
</script>

<div class="packet-dictionary-view">
  <div class="header">
    <h2>{$t('analysis.packet_dictionary.title')}</h2>
    <div class="header-actions">
      <Button variant="secondary" onclick={copyAllPackets} disabled={loading || !data}>
        {copySuccess ? $t('common.copied') : $t('common.copy')}
      </Button>
      <Button variant="secondary" onclick={fetchData} disabled={loading}>
        {loading ? $t('common.loading') : $t('common.refresh')}
      </Button>
    </div>
  </div>

  <p class="description">{$t('analysis.packet_dictionary.desc')}</p>

  {#if data}
    <div class="stats-bar">
      <span class="stat">
        {$t('analysis.packet_dictionary.parsed_count', { values: { count: '' } })}
        <span class="stat-value">{parsedPackets.length}</span>
      </span>
      <span class="stat unmatched">
        {$t('analysis.packet_dictionary.unmatched_count', { values: { count: '' } })}
        <span class="stat-value">{unmatchedPackets.length}</span>
      </span>
    </div>
  {/if}

  <div class="controls">
    <div class="view-tabs">
      <Button
        variant={viewMode === 'all' ? 'primary' : 'secondary'}
        onclick={() => (viewMode = 'all')}
      >
        <span class="tab-label">{$t('analysis.packet_dictionary.tab_all')}</span>
      </Button>
      <Button
        variant={viewMode === 'parsed' ? 'primary' : 'secondary'}
        onclick={() => (viewMode = 'parsed')}
      >
        <span class="tab-label">{$t('analysis.packet_dictionary.tab_parsed')}</span>
      </Button>
      <Button
        variant={viewMode === 'unmatched' ? 'primary' : 'secondary'}
        onclick={() => (viewMode = 'unmatched')}
      >
        <span class="tab-label">{$t('analysis.packet_dictionary.tab_unmatched')}</span>
      </Button>
      <div class="separator"></div>
      <Button
        variant="secondary"
        onclick={() => (sortDesc = !sortDesc)}
        title={sortDesc
          ? $t('analysis.packet_dictionary.sort_asc')
          : $t('analysis.packet_dictionary.sort_desc')}
      >
        <span class="sort-icon">{sortDesc ? '↓' : '↑'}</span>
        {sortDesc ? 'Z-A' : 'A-Z'}
      </Button>
    </div>
  </div>

  {#if error}
    <div class="error" transition:fade>
      <p>{error}</p>
      <Button variant="secondary" onclick={fetchData}>{$t('common.retry')}</Button>
    </div>
  {:else if loading}
    <div class="loading" transition:fade>
      <p>{$t('common.loading')}</p>
    </div>
  {:else if data}
    <div class="packet-list">
      {#if displayPackets.length === 0}
        <p class="empty">{$t('analysis.packet_dictionary.empty')}</p>
      {:else}
        {#each displayPackets as packet (packet)}
          {@const entities = data.parsedPacketEntities[packet.toLowerCase()] || []}
          {@const isParsed = parsedSet.has(packet)}
          <div class="packet-item">
            <span class="badge" class:parsed={isParsed} class:unmatched={!isParsed}>
              {isParsed
                ? $t('analysis.raw_log.set_badge_parsed')
                : $t('analysis.raw_log.set_badge_unparsed')}
            </span>
            <div class="packet-info">
              <div class="code-wrapper">
                <code class="payload">{toHexPairs(packet).join(' ')}</code>
                <button
                  class="copy-btn"
                  onclick={() => copyPacket(packet)}
                  aria-label={$t('common.copy')}
                  title={$t('common.copy')}
                >
                  {#if copiedPacket === packet}
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
              {#if entities.length > 0}
                <span class="parsed-entities">
                  → {entities.join(', ')}
                </span>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .packet-dictionary-view {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    color: #e2e8f0;
  }
  @media (max-width: 480px) {
    .packet-dictionary-view {
      padding: 0.75rem;
      border-radius: 8px;
    }
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .description {
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .stats-bar {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
    padding: 0.75rem 1rem;
    background: rgba(15, 23, 42, 0.4);
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.1);
  }

  .stat {
    font-size: 0.9rem;
    font-weight: 500;
    color: #94a3b8;
  }

  .stat.unmatched {
    color: #f59e0b;
  }

  .stat-value {
    color: #f1f5f9;
    font-weight: 600;
    margin-left: 0.25rem;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .view-tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .tab-label {
    white-space: nowrap;
  }

  .packet-list {
    max-height: 500px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.75rem;
    background: rgba(15, 23, 42, 0.3);
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.1);
  }

  .packet-item {
    display: flex;
    align-items: flex-start;
    padding: 0.5rem;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 8px;
    gap: 1rem;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    text-align: left;
  }

  .packet-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
  }

  .code-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .payload {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: #f1f5f9;
    word-break: break-all;
    line-height: 1.4;
  }

  .copy-btn {
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 0.3rem;
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

  .copy-btn:focus-visible {
    outline: 2px solid #3b82f6;
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
  }

  .success-icon {
    color: #34d399;
  }

  .parsed-entities {
    font-size: 0.75rem;
    color: #64748b;
    font-weight: 500;
  }

  .badge {
    font-size: 0.65rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    text-align: center;
    margin-top: 0.15rem;
  }

  .badge.parsed {
    background: rgba(52, 211, 153, 0.15);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.3);
  }

  .badge.unmatched {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.3);
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .loading,
  .error {
    padding: 2rem;
    text-align: center;
  }

  .separator {
    width: 1px;
    background: rgba(148, 163, 184, 0.2);
    margin: 0 0.25rem;
  }

  .sort-icon {
    margin-right: 0.25rem;
    font-weight: bold;
  }

  .error {
    color: var(--danger-color);
  }
</style>
