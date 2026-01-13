<script lang="ts">
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
  import CelAnalyzerCard from '../components/analysis/CelAnalyzerCard.svelte';
  import PortToolbar from '../components/PortToolbar.svelte';

  let {
    stats,
    commandPackets,
    parsedPackets,
    rawPackets,
    parsedEntitiesByPayload,
    packetDictionary,
    isStreaming,
    portMetadata,
    selectedPortId,
    onPortChange,
    onStart,
    onStop,
    validOnly = $bindable(false),
    isRecording = $bindable(),
    recordingStartTime = $bindable(),
    recordedFile = $bindable(),
  }: {
    stats: PacketStatsType | null;
    commandPackets: CommandPacket[];
    parsedPackets: ParsedPacket[];
    rawPackets: RawPacketWithInterval[];
    parsedEntitiesByPayload: Record<string, string[]>;
    packetDictionary: Record<string, string>;
    isStreaming: boolean;
    portMetadata: Array<BridgeSerialInfo & { configFile: string }>;
    selectedPortId: string | null;
    onPortChange?: (portId: string) => void;
    onStart?: () => void;
    onStop?: () => void;
    validOnly: boolean;
    isRecording: boolean;
    recordingStartTime: number | null;
    recordedFile: { filename: string; path: string } | null;
  } = $props();
  const portIds = $derived.by<string[]>(() =>
    portMetadata.map((port: BridgeSerialInfo & { configFile: string }) => port.portId),
  );
  const activePortId = $derived.by<string | null>(() =>
    selectedPortId && portIds.includes(selectedPortId) ? selectedPortId : (portIds[0] ?? null),
  );
</script>

<div class="analysis-view">
  <PortToolbar {portIds} {activePortId} {onPortChange} />

  <PacketLog {commandPackets} {parsedPackets} />
  <RawPacketLog
    {rawPackets}
    {parsedEntitiesByPayload}
    {packetDictionary}
    {isStreaming}
    {stats}
    {onStart}
    {onStop}
    bind:validOnly
    bind:isRecording
    bind:recordingStartTime
    bind:recordedFile
    portId={activePortId}
  />
  <CelAnalyzerCard />

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
</style>
