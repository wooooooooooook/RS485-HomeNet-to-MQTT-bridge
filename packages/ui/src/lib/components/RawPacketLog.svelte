<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { RawPacketWithInterval, PacketStats as PacketStatsType } from '../types';
  import { fade } from 'svelte/transition';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import VirtualList from '@humanspeak/svelte-virtual-list';
  import { formatTime } from '../utils/time';

  let {
    rawPackets = [],
    parsedEntitiesByPayload = {},
    packetDictionary = {},
    isStreaming,
    stats = null,
    onStart,
    onStop,
    validOnly = $bindable(false),
    isRecording = $bindable(false),
    recordingStartTime = $bindable(null),
    recordedFile = $bindable(null),
    portId = null,
  }: {
    rawPackets?: RawPacketWithInterval[];
    parsedEntitiesByPayload?: Record<string, string[]>;
    packetDictionary?: Record<string, string>;
    isStreaming: boolean;
    stats?: PacketStatsType | null;
    onStart?: () => void;
    onStop?: () => void;
    validOnly: boolean;
    isRecording: boolean;
    recordingStartTime: number | null;
    recordedFile: { filename: string; path: string } | null;
    portId: string | null;
  } = $props();

  let showSaveDialog = $state(false);
  let downloadError = $state<string | null>(null);

  let isPaused = $state(false);
  let pausedSnapshot = $state<RawPacketWithInterval[] | null>(null);
  let viewMode = $state<'log' | 'set'>('log');

  // Status tracking
  let recordingDuration = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let autoStopped = $state(false);
  let filterText = $state('');
  let debouncedFilterText = $state('');
  let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Dialog State
  let dialog = $state({
    open: false,
    title: '',
    message: '',
    confirmText: undefined as string | undefined,
    variant: 'primary' as 'primary' | 'danger' | 'success',
    loading: false,
    loadingText: undefined as string | undefined,
    showCancel: true,
    onConfirm: async () => {},
  });

  const closeConfirmDialog = () => {
    dialog.open = false;
  };

  const showAlertDialog = (
    title: string,
    message: string,
    variant: 'danger' | 'success' = 'danger',
  ) => {
    dialog.title = title;
    dialog.message = message;
    dialog.variant = variant;
    dialog.showCancel = false;
    dialog.confirmText = $t('common.confirm');
    dialog.loading = false;
    dialog.onConfirm = async () => {
      closeConfirmDialog();
    };
    dialog.open = true;
  };

  const showConfirmDialog = ({
    title,
    message,
    confirmText,
    variant = 'primary',
    loadingText,
    action,
    onSuccess,
  }: {
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'primary' | 'danger' | 'success';
    loadingText?: string;
    action: () => Promise<void>;
    onSuccess?: () => void;
  }) => {
    dialog.title = title;
    dialog.message = message;
    dialog.confirmText = confirmText;
    dialog.variant = variant;
    dialog.loadingText = loadingText;
    dialog.showCancel = true;
    dialog.loading = false;
    dialog.onConfirm = async () => {
      dialog.loading = true;
      try {
        await action();
        closeConfirmDialog();
        if (onSuccess) {
          setTimeout(onSuccess, 300);
        }
      } catch (err: any) {
        closeConfirmDialog();
        setTimeout(() => {
          showAlertDialog(
            $t('common.error') || 'Error',
            err.message || 'An error occurred',
            'danger',
          );
        }, 300);
      } finally {
        dialog.loading = false;
      }
    };
    dialog.open = true;
  };

  import PacketSender from './PacketSender.svelte';

  // Limits
  const MAX_DURATION_MS = 20 * 60 * 1000;
  const MAX_PACKETS_LIMIT = 10000;
  const FILTER_SEARCH_LIMIT = 1000; // 필터링 시 최근 N개 패킷만 검색
  const MAX_SET_ITEMS = 500;

  // Debounce filter input (300ms)
  $effect(() => {
    const text = filterText;
    if (filterDebounceTimer) {
      clearTimeout(filterDebounceTimer);
    }
    filterDebounceTimer = setTimeout(() => {
      debouncedFilterText = text;
    }, 300);
    return () => {
      if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer);
      }
    };
  });

  const normalizedFilter = $derived.by(() => debouncedFilterText.trim().toLowerCase());
  const isFiltering = $derived.by(() => normalizedFilter.length > 0);

  function getSearchPattern(filter: string) {
    if (!filter) return null;

    // Split by '*' wildcards, but keep them as parts
    const parts = filter.split(/(\*+)/);

    const patternParts = parts.reduce((acc, part) => {
      if (!part) return acc;

      if (part.startsWith('*')) {
        // Wildcard: treat as zero or more characters (non-greedy)
        acc.push('.*?');
      } else {
        // Normal text or '?' wildcard
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

  // 정규식 캐싱 - normalizedFilter가 변경될 때만 재생성
  const cachedRegex = $derived.by(() => {
    if (!normalizedFilter) return null;
    const pattern = getSearchPattern(normalizedFilter);
    if (!pattern) return null;
    try {
      return new RegExp(pattern, 'i');
    } catch {
      return null;
    }
  });

  function togglePause() {
    if (isPaused) {
      isPaused = false;
      pausedSnapshot = null;
    } else {
      isPaused = true;
      pausedSnapshot = [...rawPackets];
    }
  }

  const activePackets = $derived(isPaused && pausedSnapshot ? pausedSnapshot : rawPackets);

  // 가상 스크롤용 역순 패킷 목록 (최신 패킷이 위에 표시)
  // 필터링 시 최근 FILTER_SEARCH_LIMIT개 패킷만 검색하여 성능 개선
  const filteredPackets = $derived.by(() => {
    const source = activePackets;
    // 필터가 없으면 전체 역순 반환
    if (!normalizedFilter || !cachedRegex) {
      // 역순 정렬 - slice로 복사 후 reverse
      const len = source.length;
      const result = new Array(len);
      for (let i = 0; i < len; i++) {
        result[i] = source[len - 1 - i];
      }
      return result;
    }

    // 필터링 시 최근 N개만 검색
    const searchLimit = Math.min(source.length, FILTER_SEARCH_LIMIT);
    const startIndex = source.length - searchLimit;
    const regex = cachedRegex;
    const result: RawPacketWithInterval[] = [];

    // 역순으로 순회하며 필터링 (최신 패킷부터)
    for (let i = source.length - 1; i >= startIndex; i--) {
      const packet = source[i];
      // 문자열 생성 최소화
      const payload = packet.payload;
      const direction = packet.direction ?? 'RX';
      // 먼저 원본 payload로 테스트
      if (regex.test(payload) || regex.test(direction)) {
        result.push(packet);
        continue;
      }
      // 공백 포함 형식으로 재테스트
      const formattedPayload = toHexPairs(payload).join(' ');
      if (regex.test(formattedPayload)) {
        result.push(packet);
      }
    }

    return result;
  });

  function formatDuration(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // Monitor limits
  $effect(() => {
    if (isRecording) {
      if (rawPackets.length >= MAX_PACKETS_LIMIT || recordingDuration >= MAX_DURATION_MS) {
        autoStopped = true;
        toggleRecording();
      }
    }
  });

  // Manage timer
  $effect(() => {
    if (isRecording && recordingStartTime) {
      if (!timer) {
        // Initial sync
        recordingDuration = Date.now() - recordingStartTime;
        timer = setInterval(() => {
          if (recordingStartTime) {
            recordingDuration = Date.now() - recordingStartTime;
          }
        }, 1000);
      }
    } else {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      recordingDuration = 0;
    }
    return () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  });

  async function toggleRecording() {
    if (isRecording) {
      // Stop recording
      try {
        const response = await fetch('./api/logs/packet/stop', { method: 'POST' });
        const data = await response.json();
        if (data.success && data.result) {
          recordedFile = data.result;
          showSaveDialog = true;
        } else {
          console.error('Failed to stop logging:', data.error);
        }
      } catch (e) {
        console.error('API Error:', e);
      } finally {
        isRecording = false;
        recordingStartTime = null;
        // Stop UI streaming as well
        if (isStreaming) {
          onStop?.();
        }
        if (autoStopped) {
          showAlertDialog(
            $t('analysis.raw_log.title'),
            $t('analysis.raw_log.auto_stopped_limit'),
            'danger',
          );
        }
      }
    } else {
      // Start recording
      autoStopped = false;
      try {
        // Send UI stats to server so log metadata reflects what user has seen
        const statsPayload = stats
          ? {
              portId: stats.portId,
              packetAvg: stats.packetAvg,
              packetStdDev: stats.packetStdDev,
              idleAvg: stats.idleAvg,
              idleStdDev: stats.idleStdDev,
              idleOccurrenceAvg: stats.idleOccurrenceAvg,
              idleOccurrenceStdDev: stats.idleOccurrenceStdDev,
              sampleSize: stats.sampleSize,
            }
          : null;
        const response = await fetch('./api/logs/packet/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiStats: statsPayload,
            mode: validOnly ? 'valid' : 'all',
          }),
        });
        if (response.ok) {
          isRecording = true;
          recordedFile = null;
          showSaveDialog = false;
          downloadError = null;
          recordingStartTime = Date.now();
          // Always call onStart to ensure stats and packets are reset for the new recording session
          onStart?.();
        } else {
          // If server returns error (e.g. 500), try to show it
          const errData = await response.json();
          showAlertDialog(
            'Error',
            `Failed to start recording: ${errData.error || response.statusText}`,
            'danger',
          );
        }
      } catch (e) {
        console.error('API Error:', e);
        showAlertDialog(
          'Error',
          'Failed to start recording. Please check console for details.',
          'danger',
        );
      }
    }
  }

  function downloadLog() {
    if (!recordedFile) return;

    // Check if we are potentially in HA Companion App (iframe or specialized UserAgent)
    // The user requested explicit error handling for HA companion app
    const isHAAppName = navigator.userAgent.includes('Home Assistant');

    // Create a temporary link to force download
    const link = document.createElement('a');
    link.href = `./api/logs/packet/download/${recordedFile.filename}`;
    link.download = recordedFile.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // If in HA App, we can't easily detect if download failed, but we can warn if known limitation
    if (isHAAppName) {
      setTimeout(() => {
        downloadError = $t('analysis.raw_log.ha_app_download_warning');
      }, 500);
    }
  }

  async function copyLogContent() {
    if (!recordedFile) return;
    try {
      const response = await fetch(`./api/logs/packet/download/${recordedFile.filename}`);
      if (!response.ok) throw new Error('Failed to fetch log');
      const text = await response.text();
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error('Failed to copy log:', e);
    }
  }

  function deleteLog() {
    if (!recordedFile) return;

    showConfirmDialog({
      title: $t('analysis.raw_log.delete'),
      message: $t('analysis.raw_log.delete_confirm'),
      confirmText: $t('analysis.raw_log.delete'),
      variant: 'danger',
      action: async () => {
        const response = await fetch(`./api/logs/packet/${recordedFile!.filename}`, {
          method: 'DELETE',
        });
        if (response.ok) {
          // Clear file and close dialog
          recordedFile = null;
          showSaveDialog = false;
        } else {
          console.error('Failed to delete log');
          throw new Error('Failed to delete log');
        }
      },
      onSuccess: () => {
        showAlertDialog($t('common.success'), $t('analysis.raw_log.deleted'), 'success');
      },
    });
  }

  function closeDialog() {
    showSaveDialog = false;
    downloadError = null;
  }

  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];

  const parsedPacketSet = $derived.by(
    () => new Set(Object.values(packetDictionary).map((packet) => packet.toUpperCase())),
  );

  const validPacketSet = $derived.by(() => {
    const parsedSet = parsedPacketSet;
    const entries = new Map<
      string,
      {
        payload: string;
        count: number;
        lastSeen: string;
        lastSeenMs: number;
        parsed: boolean;
        parsedEntities: string[];
      }
    >();
    const orderedEntries: Array<{
      payload: string;
      count: number;
      lastSeen: string;
      lastSeenMs: number;
      parsed: boolean;
      parsedEntities: string[];
    }> = [];
    for (const packet of activePackets) {
      if (!packet.payload) continue;
      const payload = packet.payload.toUpperCase();
      const timestampMs = Date.parse(packet.receivedAt);
      const existing = entries.get(payload);
      if (existing) {
        existing.count += 1;
        if (timestampMs > existing.lastSeenMs) {
          existing.lastSeenMs = timestampMs;
          existing.lastSeen = packet.receivedAt;
        }
      } else {
        const parsedEntities = parsedEntitiesByPayload[payload] ?? [];
        const entry = {
          payload,
          count: 1,
          lastSeen: packet.receivedAt,
          lastSeenMs: timestampMs,
          parsed: parsedSet.has(payload),
          parsedEntities,
        };
        entries.set(payload, entry);
        orderedEntries.push(entry);
      }
    }
    let parsedCount = 0;
    let unparsedCount = 0;
    for (const entry of orderedEntries) {
      if (entry.parsed) {
        parsedCount += 1;
      } else {
        unparsedCount += 1;
      }
    }
    return {
      entries: orderedEntries,
      parsedCount,
      unparsedCount,
      total: orderedEntries.length,
    };
  });

  const filteredPacketSet = $derived.by(() => {
    const source = validPacketSet.entries;
    if (!normalizedFilter || !cachedRegex) return source;
    const regex = cachedRegex;
    return source.filter((entry) => {
      if (regex.test(entry.payload)) return true;
      const formattedPayload = toHexPairs(entry.payload).join(' ');
      return regex.test(formattedPayload);
    });
  });

  const limitedPacketSet = $derived.by(() => filteredPacketSet.slice(0, MAX_SET_ITEMS));

  const packetSetSummary = $derived.by(() => ({
    total: validPacketSet.total,
    parsed: validPacketSet.parsedCount,
    unparsed: validPacketSet.unparsedCount,
    limitedCount: limitedPacketSet.length,
  }));

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

      // Handle zero-length matches to avoid infinite loops
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }

    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), highlight: false });
    }

    return parts;
  }
</script>

{#snippet renderPacketItem(packet: RawPacketWithInterval, _index: number)}
  <div class="log-item" class:tx-packet={packet.direction === 'TX'}>
    <span class="time">[{formatTime(packet.receivedAt)}]</span>
    <span class="direction" class:tx={packet.direction === 'TX'}>
      {#each getHighlightedParts(packet.direction ?? 'RX', normalizedFilter) as part, index (`${part}-${index}`)}
        {#if part.highlight}
          <mark>{part.text}</mark>
        {:else}
          {part.text}
        {/if}
      {/each}
    </span>
    {#if !isFiltering}
      <span class="interval"
        >{packet.interval !== null
          ? `${packet.interval >= 0 ? '+' : ''}${packet.interval}ms`
          : ''}</span
      >
    {/if}
    <code class="payload" class:tx-payload={packet.direction === 'TX'}>
      {#each getHighlightedParts(toHexPairs(packet.payload).join(' '), normalizedFilter) as part, index (`${part}-${index}`)}
        {#if part.highlight}
          <mark>{part.text}</mark>
        {:else}
          {part.text}
        {/if}
      {/each}
    </code>
  </div>
{/snippet}

<!-- Packet Sender Section -->
{#if portId}
  <PacketSender {portId} />
{/if}

<div class="log-section">
  <div class="log-header">
    <div class="header-left">
      <h2>{$t('analysis.raw_log.title')}</h2>
      {#if isRecording}
        <div class="recording-status" transition:fade>
          <span class="dot"></span>
          <span class="status-text">
            {$t('analysis.raw_log.collected_packets', { values: { count: rawPackets.length } })} |
            {$t('analysis.raw_log.recording_duration', {
              values: { duration: formatDuration(recordingDuration) },
            })}
          </span>
        </div>
      {/if}
    </div>
    <div class="header-actions">
      <Button
        variant={viewMode === 'log' ? 'primary' : 'secondary'}
        onclick={() => (viewMode = 'log')}
      >
        {$t('analysis.raw_log.view_log')}
      </Button>
      <Button
        variant={viewMode === 'set' ? 'primary' : 'secondary'}
        onclick={() => (viewMode = 'set')}
      >
        {$t('analysis.raw_log.view_set')}
      </Button>
    </div>
  </div>
  <p class="description">
    {viewMode === 'log' ? $t('analysis.raw_log.desc') : $t('analysis.raw_log.set_desc')}
  </p>
  <div class="filter-row">
    <label class="filter-label">
      <span>{$t('analysis.raw_log.filter_label')}</span>
      <input
        type="text"
        placeholder={$t('analysis.raw_log.filter_placeholder')}
        bind:value={filterText}
      />
    </label>
    <label class="filter-toggle">
      <input type="checkbox" bind:checked={validOnly} />
      <span>{$t('analysis.raw_log.valid_only_label')}</span>
    </label>
    {#if isFiltering}
      <Button variant="secondary" onclick={() => (filterText = '')}>
        {$t('analysis.raw_log.clear_filter')}
      </Button>
    {/if}
  </div>
  {#if isFiltering}
    <p class="filter-hint">{$t('analysis.raw_log.filter_hint')}</p>
  {/if}
  {#if validOnly}
    <p class="filter-hint">{$t('analysis.raw_log.valid_only_hint')}</p>
  {/if}
  {#if viewMode === 'set' && !validOnly}
    <p class="filter-hint">{$t('analysis.raw_log.set_valid_hint')}</p>
  {/if}

  {#if showSaveDialog && recordedFile}
    <div class="save-dialog" transition:fade>
      <div class="save-content">
        <h3>{$t('analysis.raw_log.saved_title')}</h3>
        <p class="filename">{recordedFile.filename}</p>
        <p class="path-hint">
          {$t('analysis.raw_log.saved_path')}: <br />
          <code>{recordedFile.path}</code>
        </p>
        {#if downloadError}
          <div class="alert-warning">
            {downloadError}
          </div>
        {/if}
        <div class="actions">
          <Button variant="primary" onclick={downloadLog}>
            {$t('analysis.raw_log.download')}
          </Button>
          <Button variant="secondary" onclick={copyLogContent}>
            {$t('analysis.raw_log.copy_log')}
          </Button>
          <Button variant="danger" onclick={deleteLog}>
            {$t('analysis.raw_log.delete')}
          </Button>
          <Button variant="secondary" onclick={closeDialog}>
            {$t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  {/if}
  {#if rawPackets.length !== 0}
    <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-bottom: 0.5rem;">
      <Button variant="secondary" onclick={togglePause}>
        {isPaused ? `▶ ${$t('analysis.raw_log.resume')}` : `⏸ ${$t('analysis.raw_log.pause')}`}
      </Button>
      <Button variant="secondary" class={isRecording ? 'recording' : ''} onclick={toggleRecording}>
        {isRecording
          ? `⏹ ${$t('analysis.raw_log.stop_rec')}`
          : `⏺ ${$t('analysis.raw_log.start_rec')}`}
      </Button>
    </div>
  {/if}
  {#if viewMode === 'log'}
    <div class="log-list raw-list">
      {#if rawPackets.length === 0}
        <p class="empty">{$t('analysis.raw_log.empty')}</p>
      {:else}
        <VirtualList
          items={filteredPackets}
          renderItem={renderPacketItem}
          defaultEstimatedItemHeight={32}
        />
      {/if}
    </div>
  {:else}
    <div class="set-section">
      <div class="set-summary">
        <span
          >{$t('analysis.raw_log.set_summary', { values: { count: packetSetSummary.total } })}</span
        >
        <span class="badge parsed"
          >{$t('analysis.raw_log.set_parsed', { values: { count: packetSetSummary.parsed } })}</span
        >
        <span class="badge unparsed">
          {$t('analysis.raw_log.set_unparsed', { values: { count: packetSetSummary.unparsed } })}
        </span>
        {#if packetSetSummary.total > packetSetSummary.limitedCount}
          <span class="set-limit">
            {$t('analysis.raw_log.set_limit_hint', { values: { count: MAX_SET_ITEMS } })}
          </span>
        {/if}
      </div>
      <div class="log-list set-list">
        {#if limitedPacketSet.length === 0}
          <p class="empty">{$t('analysis.raw_log.set_empty')}</p>
        {:else}
          {#each limitedPacketSet as entry (entry.payload)}
            <div class="set-item">
              <code class="payload payload-full">
                {#each getHighlightedParts(toHexPairs(entry.payload).join(' '), normalizedFilter) as part, index (`${part}-${index}`)}
                  {#if part.highlight}
                    <mark>{part.text}</mark>
                  {:else}
                    {part.text}
                  {/if}
                {/each}
              </code>
              <div class="set-item-meta">
                <span class="badge" class:parsed={entry.parsed} class:unparsed={!entry.parsed}>
                  {entry.parsed
                    ? $t('analysis.raw_log.set_badge_parsed')
                    : $t('analysis.raw_log.set_badge_unparsed')}
                </span>
                {#if entry.parsed && entry.parsedEntities.length > 0}
                  <span class="parsed-entities">
                    {$t('analysis.raw_log.set_parsed_entities_label')}:
                    {entry.parsedEntities.join(', ')}
                  </span>
                {/if}
                <span class="set-count">x{entry.count}</span>
                <span class="set-time">{formatTime(entry.lastSeen)}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- Inline Packet Interval Analysis -->
  {#if stats}
    <div class="stats-inline" transition:fade>
      <div class="stats-header">
        <span class="stats-title">{$t('analysis.stats.title')}</span>
      </div>
      <div class="stats-row">
        <div class="stat-item">
          <span class="stat-label">{$t('analysis.stats.packet_interval')}</span>
          <span class="stat-value">{stats.packetAvg} ± {stats.packetStdDev} ms</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{$t('analysis.stats.idle_interval')}</span>
          <span class="stat-value"
            >{stats.idleAvg > 0 ? `${stats.idleAvg} ± ${stats.idleStdDev} ms` : 'N/A'}</span
          >
        </div>
        <div class="stat-item">
          <span class="stat-label">{$t('analysis.stats.idle_occurrence')}</span>
          <span class="stat-value"
            >{stats.idleOccurrenceAvg > 0
              ? `${stats.idleOccurrenceAvg} ± ${stats.idleOccurrenceStdDev} ms`
              : 'N/A'}</span
          >
        </div>
        <div class="stat-item">
          <span class="stat-label">{$t('analysis.stats.sample_size')}</span>
          <span class="stat-value">{stats.sampleSize}</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<Dialog
  open={dialog.open}
  title={dialog.title}
  message={dialog.message}
  confirmText={dialog.confirmText}
  variant={dialog.variant}
  loading={dialog.loading}
  loadingText={dialog.loadingText}
  showCancel={dialog.showCancel}
  onconfirm={dialog.onConfirm}
  oncancel={closeConfirmDialog}
/>

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

  .header-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .recording-status {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: rgba(239, 68, 68, 0.1);
    padding: 0.35rem 0.75rem;
    border-radius: 20px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .dot {
    width: 8px;
    height: 8px;
    background-color: #ef4444;
    border-radius: 50%;
    animation: blink 1s infinite;
  }

  @keyframes blink {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
    100% {
      opacity: 1;
    }
  }

  .status-text {
    font-size: 0.85rem;
    color: #fca5a5;
    font-weight: 500;
    white-space: nowrap;
  }

  h2 {
    font-size: 1.1rem;
    margin: 0;
    color: #e2e8f0;
  }

  .description {
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .filter-row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    margin: 0.75rem 0 0.25rem;
    flex-wrap: wrap;
  }

  .filter-label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: #94a3b8;
    font-size: 0.8rem;
  }

  .filter-label input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
    min-width: 240px;
    font-size: 0.85rem;
  }

  .filter-label input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.6);
    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35);
  }

  .filter-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: #cbd5e1;
    font-size: 0.85rem;
    padding: 0.2rem 0.4rem;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.4);
    border: 1px solid rgba(148, 163, 184, 0.2);
  }

  .filter-toggle input {
    accent-color: #38bdf8;
  }

  .filter-hint {
    color: #fbbf24;
    font-size: 0.8rem;
    margin: 0 0 0.75rem;
  }

  .log-list {
    margin: 0.75rem 0;
    background: rgba(15, 23, 42, 0.5);
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.1);
    height: 400px;
    padding: 0.5rem;
    overflow: hidden;
    font-family: monospace;
    font-size: 0.85rem;
  }

  .set-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .set-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    color: #94a3b8;
    font-size: 0.85rem;
  }

  .set-list {
    height: 320px;
    overflow: auto;
  }

  .set-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    color: #cbd5e1;
  }

  .set-item-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .payload-full {
    width: 100%;
    display: block;
  }

  .parsed-entities {
    color: #cbd5e1;
    font-size: 0.75rem;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    padding: 0.2rem 0.45rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .set-item:last-child {
    border-bottom: none;
  }

  .set-count {
    color: #fbbf24;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .set-time {
    color: #64748b;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    white-space: nowrap;
  }

  .badge.parsed {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
  }

  .badge.unparsed {
    background: rgba(248, 113, 113, 0.2);
    color: #fca5a5;
  }

  .set-limit {
    color: #fbbf24;
    font-size: 0.75rem;
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

    .interval {
      width: 45px;
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

  .interval {
    color: #f59e0b;
    width: 60px;
    text-align: right;
    font-size: 0.8rem;
  }

  .payload {
    color: #10b981;
    font-weight: 600;
    font-family: monospace;
  }

  .direction {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }

  .direction.tx {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }

  .tx-payload {
    color: #60a5fa;
  }

  .tx-packet {
    background: rgba(59, 130, 246, 0.05);
  }

  mark {
    background: rgba(250, 204, 21, 0.8);
    color: #131c2e;
    border-radius: 2px;
    padding: 0 1px;
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: #64748b;
    font-style: italic;
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: #64748b;
    font-style: italic;
  }

  :global(.recording) {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.4);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
    100% {
      opacity: 1;
    }
  }

  .save-dialog {
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
  }

  @media (max-width: 480px) {
    .save-dialog {
      padding: 1rem;
    }
    .actions {
      flex-direction: column;
      align-items: stretch;
    }
  }

  .save-content h3 {
    margin: 0 0 1rem 0;
    color: #fca5a5;
  }

  .filename {
    font-weight: bold;
    color: #fff;
    margin-bottom: 0.5rem;
  }

  .path-hint {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-bottom: 1.5rem;
    word-break: break-all;
  }

  .path-hint code {
    background: rgba(0, 0, 0, 0.3);
    padding: 2px 6px;
    border-radius: 4px;
    color: #cbd5e1;
  }

  .actions {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .actions {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .alert-warning {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
    color: #f59e0b;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  /* Inline Packet Interval Stats */
  .stats-inline {
    margin-top: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 8px;
  }

  .stats-header {
    margin-bottom: 0.5rem;
  }

  .stats-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
  }

  .stats-inline .stat-item {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }

  .stat-label {
    font-size: 0.8rem;
    color: #64748b;
  }

  .stat-value {
    font-size: 0.9rem;
    font-weight: 600;
    color: #10b981;
    font-family: monospace;
  }

  @media (max-width: 640px) {
    .stats-row {
      flex-direction: column;
      gap: 0.5rem;
    }

    .stats-inline .stat-item {
      justify-content: space-between;
      width: 100%;
    }
  }
</style>
