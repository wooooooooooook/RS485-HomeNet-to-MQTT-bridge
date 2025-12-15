<script lang="ts">
  let { portId } = $props<{ portId: string }>();

  let isRunning = $state(false);
  let error = $state<string | null>(null);
  let stats = $state<{
    avg: number;
    stdDev: number;
    min: number;
    max: number;
    samples: number;
  } | null>(null);

  async function runTest() {
    isRunning = true;
    error = null;
    stats = null;

    try {
      const res = await fetch(`./api/bridge/${portId}/latency-test`, {
        method: 'POST'
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('Failed to parse response:', text);
        throw new Error(`Invalid server response: ${text.substring(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(data.error || 'Test failed');
      }

      stats = data;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      isRunning = false;
    }
  }
</script>

<div class="latency-test-container">
  <h3>패킷 처리 지연시간 분석 (Latency)</h3>
  <div class="description">
    <p>
      가상 패킷을 생성하여 처리 파이프라인(수신 -> 파서 -> 자동화 -> 명령 생성)을 통과하는 시간을 측정합니다.
      <br>실제 시리얼 포트로 데이터가 전송되지는 않습니다. (100회 반복 측정)
    </p>
  </div>

  <div class="controls">
    <button class="primary" onclick={runTest} disabled={isRunning}>
      {#if isRunning}
        측정 중...
      {:else}
        측정 시작
      {/if}
    </button>
  </div>

  {#if error}
    <div class="error-message">
      {error}
    </div>
  {/if}

  {#if stats}
    <div class="results">
      <div class="stat-box">
        <div class="label">평균 (Avg)</div>
        <div class="value">{stats.avg} ms</div>
      </div>
      <div class="stat-box">
        <div class="label">표준편차 (StdDev)</div>
        <div class="value">± {stats.stdDev} ms</div>
      </div>
      <div class="stat-box">
        <div class="label">최소 (Min)</div>
        <div class="value">{stats.min} ms</div>
      </div>
      <div class="stat-box">
        <div class="label">최대 (Max)</div>
        <div class="value">{stats.max} ms</div>
      </div>
    </div>
  {/if}
</div>

<style>
  .latency-test-container {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 1.5rem;
    color: #e2e8f0;
  }

  h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    color: #f1f5f9;
  }

  .description {
    font-size: 0.9rem;
    color: #94a3b8;
    margin-bottom: 1rem;
    line-height: 1.5;
  }

  .controls {
    margin-bottom: 1rem;
  }

  button.primary {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  button.primary:hover:not(:disabled) {
    background: #2563eb;
  }

  button.primary:disabled {
    background: #475569;
    cursor: not-allowed;
    opacity: 0.7;
  }

  .error-message {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    padding: 0.75rem;
    border-radius: 4px;
    margin-top: 1rem;
  }

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1rem;
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
  }

  .stat-box {
    background: rgba(15, 23, 42, 0.5);
    padding: 1rem;
    border-radius: 6px;
    text-align: center;
  }

  .stat-box .label {
    font-size: 0.8rem;
    color: #94a3b8;
    margin-bottom: 0.25rem;
  }

  .stat-box .value {
    font-size: 1.25rem;
    font-weight: 600;
    color: #e2e8f0;
  }
</style>
