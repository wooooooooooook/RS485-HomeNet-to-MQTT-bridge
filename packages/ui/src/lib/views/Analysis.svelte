<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type {
    CommandPacket,
    PacketStats as PacketStatsType,
    RawPacketWithInterval,
    ParsedPacket,
    BridgeSerialInfo,
  } from '../types';
  import { t } from 'svelte-i18n';
  import PacketLog from '../components/PacketLog.svelte';
  import RawPacketLog from '../components/RawPacketLog.svelte';
  import LatencyTest from '../components/analysis/LatencyTest.svelte';

  let {
    stats,
    commandPackets,
    parsedPackets,
    rawPackets,
    isStreaming,
    portMetadata,
    selectedPortId,
  } = $props<{
    stats: PacketStatsType | null;
    commandPackets: CommandPacket[];
    parsedPackets: ParsedPacket[];
    rawPackets: RawPacketWithInterval[];
    isStreaming: boolean;
    portMetadata: Array<BridgeSerialInfo & { configFile: string }>;
    selectedPortId: string | null;
  }>();

  const dispatch = createEventDispatcher<{
    start: void;
    stop: void;
    portChange: { portId: string };
  }>();

  const startStreaming = () => dispatch('start');
  const stopStreaming = () => dispatch('stop');

  const portIds = $derived.by<string[]>(() =>
    portMetadata.map((port: BridgeSerialInfo & { configFile: string }) => port.portId),
  );
  const activePortId = $derived.by<string | null>(() =>
    selectedPortId && portIds.includes(selectedPortId) ? selectedPortId : (portIds[0] ?? null),
  );
</script>

<div class="analysis-view">
  <div class="port-tabs" aria-label={$t('analysis.port_tabs_aria')}>
    {#if portIds.length === 0}
      <span class="hint">{$t('analysis.no_config')}</span>
    {:else}
      {#each portIds as portId (portId)}
        <button
          class:active={activePortId === portId}
          type="button"
          onclick={() => dispatch('portChange', { portId })}
        >
          {portId}
        </button>
      {/each}
    {/if}
  </div>

  <PacketLog {commandPackets} {parsedPackets} />
  <RawPacketLog
    {rawPackets}
    {isStreaming}
    {stats}
    on:start={startStreaming}
    on:stop={stopStreaming}
  />

  {#if activePortId}
    <LatencyTest portId={activePortId} />
  {/if}
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .port-tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .port-tabs button {
    padding: 0.45rem 0.9rem;
    border-radius: 10px;
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
    border: 1px solid rgba(148, 163, 184, 0.3);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .port-tabs button.active {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.6);
    color: #bfdbfe;
  }

  .port-tabs button:hover {
    border-color: rgba(148, 163, 184, 0.6);
  }

  .hint {
    color: #94a3b8;
    font-style: italic;
  }
</style>
