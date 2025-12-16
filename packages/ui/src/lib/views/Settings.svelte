<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FrontendSettings } from '../types';

  let { frontendSettings = null, isLoading = false, isSaving = false, error = '' } = $props<{
    frontendSettings?: FrontendSettings | null;
    isLoading?: boolean;
    isSaving?: boolean;
    error?: string;
  }>();

  type ToastSettingKey = 'stateChange' | 'command';

  const dispatch = createEventDispatcher<{ toastChange: { key: ToastSettingKey; value: boolean } }>();

  const getToastValue = (key: ToastSettingKey) => {
    return frontendSettings?.toast?.[key] ?? true;
  };

  const handleToggle = (key: ToastSettingKey, event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    dispatch('toastChange', { key, value: target.checked });
  };

  // Log Sharing State
  let logSharingStatus = $state<{ asked: boolean; consented: boolean; uid?: string | null } | null>(null);

  $effect(() => {
    fetch(`./api/log-sharing/status?_=${Date.now()}`)
      .then((res) => res.json())
      .then((data) => {
        logSharingStatus = data;
      })
      .catch((err) => console.error('Failed to fetch log sharing status', err));
  });

  const handleLogSharingToggle = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const consent = input.checked;

    // Optimistic update
    if (logSharingStatus) {
      logSharingStatus = { ...logSharingStatus, consented: consent };
    }

    try {
      const res = await fetch('./api/log-sharing/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      });
      if (res.ok) {
        logSharingStatus = await res.json();
      }
    } catch (error) {
      console.error('Failed to update log sharing', error);
      // Revert on error
      if (logSharingStatus) {
        logSharingStatus = { ...logSharingStatus, consented: !consent };
      }
    }
  };
</script>

<section class="settings-view">
  <h1>설정</h1>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="card">
    <div class="card-header">
      <div>
        <h2>토스트 알림</h2>
        <p>상태 업데이트나 명령 전송 이벤트 발생 시 토스트 표시 여부를 제어합니다.</p>
      </div>
      {#if isSaving}
        <span class="badge">저장 중...</span>
      {/if}
    </div>

    {#if isLoading}
      <div class="loading">설정을 불러오는 중...</div>
    {:else}
      <div class="setting">
        <div>
          <div class="setting-title">상태 변경 토스트</div>
          <div class="setting-desc">상태 토픽 업데이트마다 토스트를 띄웁니다.</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={getToastValue('stateChange')}
            onchange={(event) => handleToggle('stateChange', event)}
            disabled={isSaving || isLoading}
          />
          <span class="slider"></span>
        </label>
      </div>

      <div class="setting">
        <div>
          <div class="setting-title">명령 전송 토스트</div>
          <div class="setting-desc">명령 패킷을 보낼 때 토스트를 띄웁니다.</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={getToastValue('command')}
            onchange={(event) => handleToggle('command', event)}
            disabled={isSaving || isLoading}
          />
          <span class="slider"></span>
        </label>
      </div>

      {#if logSharingStatus}
      <div class="setting">
        <div>
          <div class="setting-title">로그 및 데이터 공유</div>
          <div class="setting-desc">문제 해결을 위해 익명화된 로그와 패킷(1000개)을 개발자에게 전송합니다.</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={logSharingStatus.consented}
            onchange={handleLogSharingToggle}
            disabled={isSaving || isLoading}
          />
          <span class="slider"></span>
        </label>
      </div>

      {#if logSharingStatus.consented && logSharingStatus.uid}
        <div class="setting sub-setting">
           <div>
             <div class="setting-title">User ID</div>
             <div class="setting-desc">익명화된 식별자입니다: {logSharingStatus.uid}</div>
           </div>
        </div>
      {/if}
      {/if}
    {/if}
  </div>
</section>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
  }

  .card {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 16px;
    padding: 1.5rem;
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.4);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .card-header h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  .card-header p {
    margin: 0.25rem 0 0;
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .badge {
    align-self: flex-start;
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border-radius: 999px;
    padding: 0.25rem 0.75rem;
    font-size: 0.85rem;
  }

  .setting {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 0;
    border-top: 1px solid rgba(148, 163, 184, 0.15);
  }

  .setting:first-of-type {
    border-top: none;
  }

  .sub-setting {
    background: rgba(0, 0, 0, 0.1);
    padding: 1rem;
    border-radius: 8px;
    margin-top: 0.5rem;
  }

  .setting-title {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .setting-desc {
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 28px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(148, 163, 184, 0.4);
    transition: 0.2s;
    border-radius: 34px;
  }

  .slider:before {
    position: absolute;
    content: '';
    height: 22px;
    width: 22px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: rgba(59, 130, 246, 0.7);
  }

  input:checked + .slider:before {
    transform: translateX(22px);
  }

  input:disabled + .slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-banner {
    background: rgba(248, 113, 113, 0.15);
    border: 1px solid rgba(248, 113, 113, 0.4);
    border-radius: 10px;
    padding: 0.75rem 1rem;
    color: #fecaca;
  }

  .loading {
    color: #94a3b8;
    font-size: 0.95rem;
  }
</style>
