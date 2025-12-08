<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type {
    CommandPacket,
    PacketStats as PacketStatsType,
    RawPacketWithInterval,
    ParsedPacket,
  } from '$lib/types';
  import PacketStats from '$lib/components/PacketStats.svelte';
  import PacketLog from '$lib/components/PacketLog.svelte';
  import Button from '$lib/components/shared/Button.svelte';

  export let stats: PacketStatsType | null;
  export let commandPackets: CommandPacket[];
  export let parsedPackets: ParsedPacket[];
  export let rawPackets: RawPacketWithInterval[];
  export let isLogPaused: boolean;
  export let isStreaming: boolean;
  export let togglePause: () => void;

  const dispatch = createEventDispatcher();
  const startStreaming = () => dispatch('start');
  const stopStreaming = () => dispatch('stop');
</script>

<div class="analysis-view">
  <div class="stream-controls">
    {#if isStreaming}
      <Button on:click={stopStreaming} variant="danger">로깅 중지</Button>
    {:else}
      <Button on:click={startStreaming} variant="primary">로깅 시작</Button>
    {/if}
  </div>

  {#if isStreaming}
    <PacketStats {stats} />
  {/if}

  <PacketLog {commandPackets} {parsedPackets} {rawPackets} {isLogPaused} {togglePause} {isStreaming} />
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
  }
  .stream-controls {
    margin-bottom: 1rem;
    display: flex;
    justify-content: flex-end;
  }
</style>
