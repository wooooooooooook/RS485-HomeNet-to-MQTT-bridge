<script lang="ts">
  import type {
    CommandPacket,
    PacketStats as PacketStatsType,
    RawPacketWithInterval,
    ParsedPacket,
    BridgeSerialInfo,
    PacketLogEntry,
    CommandLogEntry,
  } from '../types';
  import PacketLog from '../components/PacketLog.svelte';
  import RawPacketLog from '../components/RawPacketLog.svelte';
  import PacketDictionaryView from '../components/PacketDictionaryView.svelte';
  import CelAnalyzerCard from '../components/analysis/CelAnalyzerCard.svelte';

  type AnalyzerStateOption = {
    id: string;
    label: string;
    state: Record<string, unknown>;
    portId?: string;
  };

  let {
    stats,
    parsedPackets, // Legacy prop, kept for compatibility if needed elsewhere
    commandPackets, // Legacy prop, kept for compatibility if needed elsewhere
    rawPackets,
    packetDictionary,
    isStreaming,
    portMetadata,
    activePortId,
    onStart,
    onStop,
    validOnly = $bindable(false),
    isRecording = $bindable(),
    recordingStartTime = $bindable(),
    recordedFile = $bindable(),
    logRetentionEnabled,
    parsedLogs = [],
    commandLogs = [],
    statesSnapshot,
    stateOptions,
  }: {
    stats: PacketStatsType | null;
    parsedPackets: ParsedPacket[];
    commandPackets: CommandPacket[];
    rawPackets: RawPacketWithInterval[];
    packetDictionary: Record<string, string>;
    isStreaming: boolean;
    portMetadata: Array<BridgeSerialInfo & { configFile: string }>;
    activePortId: string | null;
    onStart?: () => void;
    onStop?: () => void;
    validOnly: boolean;
    isRecording: boolean;
    recordingStartTime: number | null;
    recordedFile: { filename: string; path: string } | null;
    logRetentionEnabled: boolean;
    parsedLogs: PacketLogEntry[];
    commandLogs: CommandLogEntry[];
    statesSnapshot: Record<string, Record<string, unknown>>;
    stateOptions: AnalyzerStateOption[];
  } = $props();
  const portIds = $derived.by<string[]>(() =>
    portMetadata.map((port: BridgeSerialInfo & { configFile: string }) => port.portId),
  );
</script>

<div class="analysis-view">
  <PacketLog {commandLogs} {parsedLogs} {packetDictionary} />
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
    <PacketDictionaryView portId={activePortId} />
  {/if}
  <CelAnalyzerCard {statesSnapshot} {stateOptions} />
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
</style>
