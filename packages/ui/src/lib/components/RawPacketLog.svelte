<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { RawPacketWithInterval, PacketStats as PacketStatsType } from '../types';
  import PacketStats from './PacketStats.svelte';
  import { fade } from 'svelte/transition';
  import Button from './Button.svelte';
  import VirtualList from '@humanspeak/svelte-virtual-list';

  let {
    rawPackets = [],
    isStreaming,
    stats = null,
    onStart,
    onStop,
    isRecording = $bindable(false),
    recordingStartTime = $bindable(null),
    recordedFile = $bindable(null),
  }: {
    rawPackets?: RawPacketWithInterval[];
    isStreaming: boolean;
    stats?: PacketStatsType | null;
    onStart?: () => void;
    onStop?: () => void;
    isRecording: boolean;
    recordingStartTime: number | null;
    recordedFile: { filename: string; path: string } | null;
  } = $props();

  let showSaveDialog = $state(false);
  let downloadError = $state<string | null>(null);

  // Status tracking
  let recordingDuration = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let autoStopped = $state(false);

  // Limits
  const MAX_DURATION_MS = 20 * 60 * 1000;
  const MAX_PACKETS_LIMIT = 10000;

  // 가상 스크롤용 역순 패킷 목록 (최신 패킷이 위에 표시)
  const reversedPackets = $derived([...rawPackets].reverse());

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
          alert($t('analysis.raw_log.auto_stopped_limit'));
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
          body: JSON.stringify({ uiStats: statsPayload }),
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
          alert(`Failed to start recording: ${errData.error || response.statusText}`);
        }
      } catch (e) {
        console.error('API Error:', e);
        alert('Failed to start recording. Please check console for details.');
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

  async function deleteLog() {
    if (!recordedFile) return;
    if (!confirm($t('analysis.raw_log.delete_confirm'))) return;

    try {
      const response = await fetch(`./api/logs/packet/${recordedFile.filename}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        // Clear file and close dialog
        recordedFile = null;
        showSaveDialog = false;
        alert($t('analysis.raw_log.deleted'));
      } else {
        console.error('Failed to delete log');
      }
    } catch (e) {
      console.error('Delete API Error:', e);
    }
  }

  function closeDialog() {
    showSaveDialog = false;
    downloadError = null;
  }

  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];
</script>

{#snippet renderPacketItem(packet: RawPacketWithInterval, _index: number)}
  <div class="log-item" class:tx-packet={packet.direction === 'TX'}>
    <span class="time">[{new Date(packet.receivedAt).toLocaleTimeString()}]</span>
    <span class="direction" class:tx={packet.direction === 'TX'}>{packet.direction ?? 'RX'}</span>
    <span class="interval"
      >{packet.interval !== null
        ? `${packet.interval >= 0 ? '+' : ''}${packet.interval}ms`
        : ''}</span
    >
    <code class="payload" class:tx-payload={packet.direction === 'TX'}
      >{toHexPairs(packet.payload).join(' ')}</code
    >
  </div>
{/snippet}

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
    <Button variant="secondary" class={isRecording ? 'recording' : ''} onclick={toggleRecording}>
      {isRecording
        ? `⏹ ${$t('analysis.raw_log.stop_rec')}`
        : `⏺ ${$t('analysis.raw_log.start_rec')}`}
    </Button>
  </div>
  <p class="description">{$t('analysis.raw_log.desc')}</p>

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

  {#if stats || isStreaming}
    <PacketStats {stats} />
  {/if}

  <div class="log-list raw-list">
    {#if rawPackets.length === 0}
      <p class="empty">{$t('analysis.raw_log.empty')}</p>
    {:else}
      <VirtualList
        items={reversedPackets}
        renderItem={renderPacketItem}
        defaultEstimatedItemHeight={32}
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
    margin-bottom: 2rem;
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
</style>
