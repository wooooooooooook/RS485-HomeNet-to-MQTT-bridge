<script lang="ts">
  import type {
    CommandPacket,
    PacketStats as PacketStatsType,
    RawPacketWithInterval,
    ParsedPacket,
    BridgeSerialInfo,
  } from '../types';
  import PacketLog from '../components/PacketLog.svelte';
  import RawPacketLog from '../components/RawPacketLog.svelte';
  import PacketDictionaryView from '../components/PacketDictionaryView.svelte';
  import CelAnalyzerCard from '../components/analysis/CelAnalyzerCard.svelte';
  import PortToolbar from '../components/PortToolbar.svelte';

  let {
    stats,
    commandPackets,
    parsedPackets,
    rawPackets,
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
    logRetentionEnabled,
  }: {
    stats: PacketStatsType | null;
    commandPackets: CommandPacket[];
    parsedPackets: ParsedPacket[];
    rawPackets: RawPacketWithInterval[];
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
    logRetentionEnabled: boolean;
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
  {#if logRetentionEnabled}
    <PacketDictionaryView />
  {/if}
  <CelAnalyzerCard />
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
</style>
