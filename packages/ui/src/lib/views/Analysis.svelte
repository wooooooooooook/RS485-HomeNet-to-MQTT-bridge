<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type {
    CommandPacket,
    PacketStats as PacketStatsType,
    RawPacketWithInterval,
    ParsedPacket,
  } from '../types';
  import PacketLog from '../components/PacketLog.svelte';
  import RawPacketLog from '../components/RawPacketLog.svelte';

  export let stats: PacketStatsType | null;
  export let commandPackets: CommandPacket[];
  export let parsedPackets: ParsedPacket[];
  export let rawPackets: RawPacketWithInterval[];
  export let isStreaming: boolean;

  const dispatch = createEventDispatcher();
  const startStreaming = () => dispatch('start');
  const stopStreaming = () => dispatch('stop');
</script>

<div class="analysis-view">
  <PacketLog {commandPackets} {parsedPackets} />
  <RawPacketLog
    {rawPackets}
    {isStreaming}
    {stats}
    on:start={startStreaming}
    on:stop={stopStreaming}
  />
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
  }
</style>
