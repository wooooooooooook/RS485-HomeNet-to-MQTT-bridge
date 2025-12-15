<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type {
    CommandPacket,
    PacketStats as PacketStatsType,
    RawPacketWithInterval,
    ParsedPacket,
    BridgeSerialInfo,
  } from '../types';
  import PacketLog from '../components/PacketLog.svelte';
  import RawPacketLog from '../components/RawPacketLog.svelte';
  import PacketStats from '../components/PacketStats.svelte';
  import LatencyAnalysisTool from '../components/LatencyAnalysisTool.svelte';

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
    selectedPortId && portIds.includes(selectedPortId) ? selectedPortId : portIds[0] ?? null,
  );

  let activeTab = $state<'log' | 'analysis'>('log');
</script>

<div class="analysis-view">
  <div class="tabs-container">
    <div class="port-tabs" aria-label="포트 선택">
      {#if portIds.length === 0}
        <span class="hint">포트 구성이 없습니다.</span>
      {:else}
        {#each portIds as portId}
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

    <div class="view-tabs" aria-label="뷰 선택">
      <button
        class:active={activeTab === 'log'}
        type="button"
        onclick={() => (activeTab = 'log')}
      >
        패킷 로그
      </button>
      <button
        class:active={activeTab === 'analysis'}
        type="button"
        onclick={() => (activeTab = 'analysis')}
      >
        분석
      </button>
    </div>
  </div>

  {#if activeTab === 'log'}
    <div class="tab-content">
      <PacketLog {commandPackets} {parsedPackets} />
      <RawPacketLog
        {rawPackets}
        {isStreaming}
        stats={stats}
        showStats={false}
        on:start={startStreaming}
        on:stop={stopStreaming}
      />
    </div>
  {:else if activeTab === 'analysis'}
    <div class="tab-content analysis-tab">
      <div class="section-header">
        <h2>패킷 간격 분석</h2>
        <button
          class="control-btn"
          class:active={isStreaming}
          onclick={isStreaming ? stopStreaming : startStreaming}
        >
          {isStreaming ? '⏹ 분석 중지' : '▶ 분석 시작'}
        </button>
      </div>
      <p class="description">
        RS485 버스의 패킷 간격과 유휴(Idle) 시간을 실시간으로 분석하여 통신 안정성을 진단합니다.
      </p>

      <PacketStats {stats} showTitle={false} />

      <div class="spacer"></div>

      <LatencyAnalysisTool />
    </div>
  {/if}
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .tabs-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .port-tabs,
  .view-tabs {
    display: flex;
    gap: 0.5rem;
  }

  .port-tabs button,
  .view-tabs button {
    padding: 0.45rem 0.9rem;
    border-radius: 8px;
    background: rgba(148, 163, 184, 0.1);
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.1);
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 0.9rem;
  }

  .port-tabs button:hover,
  .view-tabs button:hover {
    background: rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
  }

  .port-tabs button.active {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.5);
    color: #93c5fd;
  }

  .view-tabs button.active {
    background: rgba(124, 58, 237, 0.15);
    border-color: rgba(124, 58, 237, 0.5);
    color: #c4b5fd;
    font-weight: 600;
  }

  .hint {
    color: #94a3b8;
    font-style: italic;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h2 {
    font-size: 1.25rem;
    color: #e2e8f0;
    margin: 0;
  }

  .description {
    color: #94a3b8;
    margin-bottom: 2rem;
    font-size: 0.95rem;
  }

  .control-btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: transparent;
    color: #cbd5e1;
    cursor: pointer;
    transition: all 0.2s;
  }

  .control-btn:hover {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.5);
  }

  .control-btn.active {
    background: rgba(220, 38, 38, 0.1);
    border-color: rgba(220, 38, 38, 0.5);
    color: #fca5a5;
  }

  .control-btn:not(.active) {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.5);
    color: #6ee7b7;
  }

  .spacer {
    height: 3rem;
  }
</style>
