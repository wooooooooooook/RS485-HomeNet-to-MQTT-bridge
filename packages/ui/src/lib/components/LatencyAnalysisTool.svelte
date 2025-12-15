<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let isRunning = $state(false);
  let results = $state<Array<{ id: number; timestamp: string; rtt: number }>>([]);
  let averageLatency = $state(0);
  let jitter = $state(0);

  function startTest() {
    isRunning = true;
    results = [];
    // Mock simulation for now since backend API is not available
    let count = 0;
    const interval = setInterval(() => {
      if (count >= 10 || !isRunning) {
        clearInterval(interval);
        isRunning = false;
        return;
      }

      const rtt = Math.floor(Math.random() * 20) + 10; // 10-30ms random latency
      const newResult = {
        id: count + 1,
        timestamp: new Date().toLocaleTimeString(),
        rtt
      };

      results = [...results, newResult];

      // Calculate stats
      const rtts = results.map(r => r.rtt);
      averageLatency = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length);
      const mean = averageLatency;
      jitter = Math.round(Math.sqrt(rtts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rtts.length));

      count++;
    }, 500);
  }

  function stopTest() {
    isRunning = false;
  }
</script>

<div class="latency-tool">
  <div class="tool-header">
    <div class="header-left">
      <h3>지연 시간 테스트 (Latency Test)</h3>
      <p class="desc">
        시스템이 명령을 보내고 장치로부터 응답(ACK/State)을 받을 때까지의 왕복 시간(RTT)을 측정합니다.
        <br>
        <span class="note">* 현재는 시뮬레이션 데이터입니다.</span>
      </p>
    </div>
    <div class="controls">
      {#if isRunning}
        <button class="stop-btn" onclick={stopTest}>⏹ 중지</button>
      {:else}
        <button class="start-btn" onclick={startTest}>▶ 테스트 시작</button>
      {/if}
    </div>
  </div>

  <div class="stats-summary">
    <div class="stat-box">
      <span class="label">평균 지연 시간</span>
      <span class="value">{averageLatency} ms</span>
    </div>
    <div class="stat-box">
      <span class="label">지터 (Jitter)</span>
      <span class="value">± {jitter} ms</span>
    </div>
    <div class="stat-box">
      <span class="label">패킷 손실률</span>
      <span class="value">0%</span>
    </div>
  </div>

  <div class="results-log">
    {#if results.length === 0}
      <p class="empty-log">테스트를 시작하면 결과가 여기에 표시됩니다.</p>
    {:else}
      <div class="log-header-row">
        <span>#</span>
        <span>시간</span>
        <span>RTT</span>
        <span>상태</span>
      </div>
      <div class="log-rows">
        {#each results as res}
          <div class="log-row">
            <span class="col-id">{res.id}</span>
            <span class="col-time">{res.timestamp}</span>
            <span class="col-rtt">{res.rtt} ms</span>
            <span class="col-status success">성공</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .latency-tool {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
  }

  .tool-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  h3 {
    font-size: 1.1rem;
    margin: 0 0 0.5rem 0;
    color: #e2e8f0;
  }

  .desc {
    color: #94a3b8;
    font-size: 0.9rem;
    margin: 0;
    line-height: 1.4;
  }

  .note {
    font-size: 0.8rem;
    color: #f59e0b;
    font-style: italic;
  }

  .controls button {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }

  .start-btn {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.5);
  }

  .start-btn:hover {
    background: rgba(59, 130, 246, 0.3);
  }

  .stop-btn {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.5);
  }

  .stop-btn:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .stats-summary {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: rgba(15, 23, 42, 0.3);
    border-radius: 8px;
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stat-box .label {
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .stat-box .value {
    font-size: 1.1rem;
    font-weight: 600;
    color: #f1f5f9;
    font-family: monospace;
  }

  .results-log {
    background: rgba(15, 23, 42, 0.3);
    border-radius: 8px;
    height: 200px;
    overflow-y: auto;
    font-size: 0.9rem;
  }

  .empty-log {
    padding: 2rem;
    text-align: center;
    color: #64748b;
    font-style: italic;
  }

  .log-header-row {
    display: grid;
    grid-template-columns: 50px 100px 100px 1fr;
    padding: 0.75rem 1rem;
    background: rgba(148, 163, 184, 0.05);
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    color: #94a3b8;
    font-size: 0.8rem;
    position: sticky;
    top: 0;
  }

  .log-rows {
    display: flex;
    flex-direction: column;
  }

  .log-row {
    display: grid;
    grid-template-columns: 50px 100px 100px 1fr;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    color: #cbd5e1;
    font-family: monospace;
  }

  .col-id {
    color: #64748b;
  }

  .col-rtt {
    color: #fbbf24;
  }

  .col-status.success {
    color: #34d399;
  }
</style>
