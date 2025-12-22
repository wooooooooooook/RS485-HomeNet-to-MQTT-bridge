<script lang="ts">
  import { t, locale, locales } from 'svelte-i18n';
  import LogConsentModal from '../components/LogConsentModal.svelte';
  import type { FrontendSettings, LogRetentionStats, SavedLogFile } from '../types';

  type ToastSettingKey = 'stateChange' | 'command';

  let {
    frontendSettings = null,
    isLoading = false,
    isSaving = false,
    error = '',
    onToastChange,
    onLocaleChange,
  }: {
    frontendSettings?: FrontendSettings | null;
    isLoading?: boolean;
    isSaving?: boolean;
    error?: string;
    onToastChange?: (key: ToastSettingKey, value: boolean) => void;
    onLocaleChange?: (value: string) => void;
  } = $props();

  const getToastValue = (key: ToastSettingKey) => {
    return frontendSettings?.toast?.[key] ?? true;
  };

  const handleToggle = (key: ToastSettingKey, event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    onToastChange?.(key, target.checked);
  };

  const handleLocaleChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement;
    onLocaleChange?.(target.value);
  };

  // Log Sharing State
  let logSharingStatus = $state<{ asked: boolean; consented: boolean; uid?: string | null } | null>(
    null,
  );
  let showConsentModal = $state(false);

  const fetchLogSharingStatus = () => {
    fetch(`./api/log-sharing/status?_=${Date.now()}`)
      .then((res) => res.json())
      .then((data) => {
        logSharingStatus = data;
      })
      .catch((err) => console.error('Failed to fetch log sharing status', err));
  };

  $effect(() => {
    fetchLogSharingStatus();
  });

  const handleLogSharingToggle = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const consent = input.checked;

    if (consent) {
      // Enabling: Show modal for consent
      e.preventDefault(); // Prevent checkbox from checking immediately
      input.checked = false; // Ensure it stays unchecked visually
      showConsentModal = true;
      return;
    }

    // Disabling: Process immediately
    // Optimistic update
    if (logSharingStatus) {
      logSharingStatus = { ...logSharingStatus, consented: false };
    }

    try {
      const res = await fetch('./api/log-sharing/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: false }),
      });
      if (res.ok) {
        logSharingStatus = await res.json();
      }
    } catch (error) {
      console.error('Failed to update log sharing', error);
      // Revert on error
      if (logSharingStatus) {
        logSharingStatus = { ...logSharingStatus, consented: true };
      }
    }
  };

  // Log Caching State
  let cacheSettings = $state<{
    enabled: boolean;
    autoSaveEnabled: boolean;
    retentionCount: number;
  } | null>(null);
  let cacheStats = $state<LogRetentionStats | null>(null);
  let cacheFiles = $state<SavedLogFile[]>([]);
  let isCacheSaving = $state(false);

  const fetchCacheSettings = async () => {
    try {
      const res = await fetch(`./api/logs/cache/settings?_=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        cacheSettings = data.settings;
      }
    } catch (err) {
      console.error('Failed to fetch cache settings', err);
    }
  };

  const fetchCacheStats = async () => {
    try {
      const res = await fetch(`./api/logs/cache/stats?_=${Date.now()}`);
      if (res.ok) {
        cacheStats = await res.json();
      }
    } catch (err) {
      console.error('Failed to fetch cache stats', err);
    }
  };

  const fetchCacheFiles = async () => {
    try {
      const res = await fetch(`./api/logs/cache/files?_=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        cacheFiles = data.files || [];
      }
    } catch (err) {
      console.error('Failed to fetch cache files', err);
    }
  };

  $effect(() => {
    fetchCacheSettings();
    fetchCacheStats();
    fetchCacheFiles();

    // Refresh stats every 30 seconds if caching is enabled
    const interval = setInterval(() => {
      if (cacheSettings?.enabled) {
        fetchCacheStats();
      }
    }, 30000);

    return () => clearInterval(interval);
  });

  const updateCacheSettings = async (updates: Partial<typeof cacheSettings>) => {
    if (!cacheSettings) return;

    isCacheSaving = true;
    const newSettings = { ...cacheSettings, ...updates };

    try {
      const res = await fetch('./api/logs/cache/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: newSettings }),
      });
      if (res.ok) {
        const data = await res.json();
        cacheSettings = data.settings;
        // Refresh stats after enabling/disabling
        await fetchCacheStats();
      }
    } catch (err) {
      console.error('Failed to update cache settings', err);
    } finally {
      isCacheSaving = false;
    }
  };

  const handleCacheToggle = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    updateCacheSettings({ enabled: input.checked });
  };

  const handleAutoSaveToggle = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    updateCacheSettings({ autoSaveEnabled: input.checked });
  };

  const handleRetentionChange = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const value = parseInt(input.value, 10);
    if (value > 0 && value <= 30) {
      updateCacheSettings({ retentionCount: value });
    }
  };

  const downloadCacheFile = (filename: string) => {
    window.open(`./api/logs/cache/download/${filename}`, '_blank');
  };

  const deleteCacheFile = async (filename: string) => {
    if (!confirm($t('settings.log_retention.delete_confirm'))) return;

    try {
      const res = await fetch(`./api/logs/cache/${filename}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchCacheFiles();
      }
    } catch (err) {
      console.error('Failed to delete cache file', err);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
</script>

<section class="settings-view">
  {#if showConsentModal}
    <LogConsentModal
      onclose={() => {
        showConsentModal = false;
        fetchLogSharingStatus();
      }}
    />
  {/if}

  <div class="view-header">
    <h1>{$t('settings.title')}</h1>
    <div class="lang-switcher">
      <select value={$locale} onchange={handleLocaleChange} disabled={isSaving || isLoading}>
        {#each $locales as l}
          <option value={l}>
            {l === 'ko' ? $t('common.korean') : $t('common.english')}
          </option>
        {/each}
      </select>
    </div>
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="card">
    <div class="card-header">
      <div>
        <h2>{$t('settings.toast.title')}</h2>
        <p>{$t('settings.toast.desc')}</p>
      </div>
      {#if isSaving}
        <span class="badge">{$t('settings.saving')}</span>
      {/if}
    </div>

    {#if isLoading}
      <div class="loading">{$t('settings.loading')}</div>
    {:else}
      <div class="setting">
        <div>
          <div class="setting-title">{$t('settings.toast.state_change.title')}</div>
          <div class="setting-desc">{$t('settings.toast.state_change.desc')}</div>
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
          <div class="setting-title">{$t('settings.toast.command.title')}</div>
          <div class="setting-desc">{$t('settings.toast.command.desc')}</div>
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
    {/if}
  </div>

  <div class="card">
    <div class="card-header">
      <div>
        <h2>{$t('settings.log_sharing.title')}</h2>
        <p>{$t('settings.log_sharing.desc')}</p>
      </div>
    </div>

    {#if !logSharingStatus}
      <div class="loading">{$t('settings.loading')}</div>
    {:else}
      <div class="setting">
        <div>
          <div class="setting-title">{$t('settings.log_sharing.enable')}</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={logSharingStatus.consented}
            onchange={handleLogSharingToggle}
          />
          <span class="slider"></span>
        </label>
      </div>

      {#if logSharingStatus.consented && logSharingStatus.uid}
        <div class="setting sub-setting">
          <div>
            <div class="setting-title">{$t('settings.log_sharing.uid_title')}</div>
            <div class="setting-desc">
              {$t('settings.log_sharing.uid_desc', { values: { uid: logSharingStatus.uid } })}
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Log Caching Card -->
  <div class="card">
    <div class="card-header">
      <div>
        <h2>{$t('settings.log_retention.title')}</h2>
        <p>{$t('settings.log_retention.desc')}</p>
      </div>
      {#if isCacheSaving}
        <span class="badge">{$t('settings.saving')}</span>
      {/if}
    </div>

    {#if !cacheSettings}
      <div class="loading">{$t('settings.loading')}</div>
    {:else}
      <div class="setting">
        <div>
          <div class="setting-title">{$t('settings.log_retention.enable')}</div>
          <div class="setting-desc">{$t('settings.log_retention.enable_desc')}</div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={cacheSettings.enabled}
            onchange={handleCacheToggle}
            disabled={isCacheSaving}
          />
          <span class="slider"></span>
        </label>
      </div>

      {#if cacheSettings.enabled && cacheStats}
        <div class="setting sub-setting">
          <div>
            <div class="setting-title">{$t('settings.log_retention.memory_usage')}</div>
            <div class="setting-desc stats">
              <span class="stat-value">{formatBytes(cacheStats.memoryUsageBytes)}</span>
              <span class="stat-detail">
                ({$t('settings.log_retention.packets')}: {cacheStats.packetLogCount.toLocaleString()},
                Raw: {cacheStats.rawPacketLogCount.toLocaleString()},
                {$t('settings.log_retention.activity')}: {cacheStats.activityLogCount.toLocaleString()})
              </span>
            </div>
          </div>
        </div>

        <div class="setting">
          <div>
            <div class="setting-title">{$t('settings.log_retention.auto_save')}</div>
            <div class="setting-desc">{$t('settings.log_retention.auto_save_desc')}</div>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              checked={cacheSettings.autoSaveEnabled}
              onchange={handleAutoSaveToggle}
              disabled={isCacheSaving}
            />
            <span class="slider"></span>
          </label>
        </div>

        {#if cacheSettings.autoSaveEnabled}
          <div class="setting sub-setting">
            <div>
              <div class="setting-title">{$t('settings.log_retention.retention_count')}</div>
              <div class="setting-desc">{$t('settings.log_retention.retention_count_desc')}</div>
            </div>
            <input
              type="number"
              class="number-input"
              min="1"
              max="30"
              value={cacheSettings.retentionCount}
              onchange={handleRetentionChange}
              disabled={isCacheSaving}
            />
          </div>
        {/if}
      {/if}

      {#if cacheFiles.length > 0}
        <div class="setting files-section">
          <div class="setting-title">{$t('settings.log_retention.saved_files')}</div>
          <div class="files-list">
            {#each cacheFiles as file}
              <div class="file-row">
                <span class="file-name">{file.filename}</span>
                <span class="file-size">{formatBytes(file.size)}</span>
                <div class="file-actions">
                  <button
                    class="btn-icon"
                    onclick={() => downloadCacheFile(file.filename)}
                    title={$t('settings.log_retention.download')}
                  >
                    ⬇
                  </button>
                  <button
                    class="btn-icon danger"
                    onclick={() => deleteCacheFile(file.filename)}
                    title={$t('settings.log_retention.delete')}
                  >
                    🗑
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if cacheSettings.autoSaveEnabled}
        <div class="setting sub-setting">
          <div class="setting-desc muted">{$t('settings.log_retention.no_files')}</div>
        </div>
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

  .view-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
  }

  .lang-switcher select {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    cursor: pointer;
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

  /* Log Caching Styles */
  .number-input {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    width: 80px;
    text-align: center;
    font-size: 0.95rem;
  }

  .number-input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.5);
  }

  .stats {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stat-value {
    font-size: 1.25rem;
    font-weight: 600;
    color: #60a5fa;
  }

  .stat-detail {
    font-size: 0.8rem;
    color: #64748b;
  }

  .muted {
    color: #64748b;
    font-style: italic;
  }

  .files-section {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 8px;
  }

  .file-name {
    flex: 1;
    font-family: monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .file-size {
    color: #94a3b8;
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .file-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-icon {
    background: rgba(59, 130, 246, 0.15);
    border: none;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    font-size: 1rem;
    transition: background 0.2s;
  }

  .btn-icon:hover {
    background: rgba(59, 130, 246, 0.3);
  }

  .btn-icon.danger {
    background: rgba(248, 113, 113, 0.15);
  }

  .btn-icon.danger:hover {
    background: rgba(248, 113, 113, 0.3);
  }
</style>
