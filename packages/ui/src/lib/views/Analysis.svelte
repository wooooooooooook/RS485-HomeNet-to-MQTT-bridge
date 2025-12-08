<script lang="ts">
  import type {
    CommandPacket,
    PacketStats as PacketStatsType,
    RawPacketWithInterval,
  } from '../types';
  import PacketStats from '../components/PacketStats.svelte';
  import PacketLog from '../components/PacketLog.svelte';

  export let stats: PacketStatsType | null;
  export let commandPackets: CommandPacket[];
  export let rawPackets: RawPacketWithInterval[];
  export let isLogPaused: boolean;
  export let togglePause: () => void;
</script>

<div class="analysis-view">
  <PacketStats {stats} />
  <PacketLog {commandPackets} {rawPackets} {isLogPaused} {togglePause} />
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
  }
</style>
