<script lang="ts">
  import { t, locale, locales } from 'svelte-i18n';
  import LogConsentModal from '../components/LogConsentModal.svelte';
  import SetupWizard from '../components/SetupWizard.svelte';
  import BridgeConfigEditorModal from '../components/BridgeConfigEditorModal.svelte';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import type {
    FrontendSettings,
    LogRetentionStats,
    SavedLogFile,
    BridgeInfo,
    BackupFile,
  } from '../types';

  type ToastSettingKey = 'stateChange' | 'command';

  let {
    frontendSettings = null,
    bridgeInfo = null,
    isLoading = false,
    isSaving = false,
    error = '',
    onToastChange,
    onLocaleChange,
  }: {
    frontendSettings?: FrontendSettings | null;
    bridgeInfo?: BridgeInfo | null;
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
  let showAddBridgeModal = $state(false);
  let editingConfigFile = $state<string | null>(null);

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

  const handleLogSharingToggle = async (checked: boolean) => {
    const consent = checked;

    if (consent) {
      // Enabling: Show modal for consent
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
    ttlHours: number;
  } | null>(null);
  let cacheStats = $state<LogRetentionStats | null>(null);
  let cacheFiles = $state<SavedLogFile[]>([]);
  let isCacheSaving = $state(false);
  let deletingFile = $state<string | null>(null);
  let downloadError = $state<string | null>(null);
  const logFileCollapseThreshold = 5;
  let cacheFilesOpen = $state(false);

  let backupFiles = $state<BackupFile[]>([]);
  let backupTotalSize = $state(0);
  let isBackupWorking = $state(false);
  let deletingBackup = $state<string | null>(null);
  let backupDownloadError = $state<string | null>(null);
  const backupFileCollapseThreshold = 5;
  let backupFilesOpen = $state(false);

  const shouldCollapseCacheFiles = $derived(cacheFiles.length > logFileCollapseThreshold);
  const shouldCollapseBackupFiles = $derived(backupFiles.length > backupFileCollapseThreshold);

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

  const fetchBackupFiles = async () => {
    try {
      const res = await fetch(`./api/backups?_=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        backupFiles = data.files || [];
        backupTotalSize = data.totalSize || 0;
      }
    } catch (err) {
      console.error('Failed to fetch backup files', err);
    }
  };

  $effect(() => {
    fetchCacheSettings();
    fetchCacheStats();
    fetchCacheFiles();
    fetchBackupFiles();

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

  const handleManualSave = async () => {
    isCacheSaving = true;
    try {
      const res = await fetch('./api/logs/cache/save', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.result?.filename) {
          // Trigger download
          downloadCacheFile(data.result.filename);
          // Refresh file list
          await fetchCacheFiles();
        }
      } else {
        console.error('Failed to save logs');
      }
    } catch (err) {
      console.error('Error saving logs', err);
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

  const handleTtlChange = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const value = parseInt(input.value, 10);
    if (value > 0 && value <= 168) {
      updateCacheSettings({ ttlHours: value });
    }
  };

  const downloadCacheFile = (filename: string) => {
    downloadError = null;
    const isHAAppName = navigator.userAgent.includes('Home Assistant');
    const link = document.createElement('a');
    link.href = `./api/logs/cache/download/${filename}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (isHAAppName) {
      setTimeout(() => {
        downloadError = $t('analysis.raw_log.ha_app_download_warning');
      }, 500);
    }
  };

  const deleteCacheFile = async (filename: string) => {
    showConfirmDialog({
      title: $t('settings.log_retention.delete_confirm_title'),
      message: $t('settings.log_retention.delete_confirm'),
      confirmText: $t('common.delete'),
      variant: 'danger',
      action: async () => {
        deletingFile = filename;
        const res = await fetch(`./api/logs/cache/${filename}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          await fetchCacheFiles();
        } else {
          throw new Error('Failed to delete file');
        }
      },
      onSuccess: () => {
        deletingFile = null;
      },
    });
  };

  const downloadBackupFile = (filename: string) => {
    backupDownloadError = null;
    const isHAAppName = navigator.userAgent.includes('Home Assistant');
    const link = document.createElement('a');
    link.href = `./api/backups/download/${filename}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (isHAAppName) {
      setTimeout(() => {
        backupDownloadError = $t('analysis.raw_log.ha_app_download_warning');
      }, 500);
    }
  };

  const deleteBackupFile = async (filename: string) => {
    if (!confirm($t('settings.backup_management.delete_confirm', { values: { filename } }))) return;

    deletingBackup = filename;
    try {
      const res = await fetch(`./api/backups/${filename}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchBackupFiles();
      }
    } catch (err) {
      console.error('Failed to delete backup file', err);
    } finally {
      deletingBackup = null;
    }
  };

  const cleanupBackups = async (mode: 'all' | 'keep_recent', keepCount = 3) => {
    isBackupWorking = true;
    try {
      const res = await fetch('./api/backups/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, keepCount }),
      });
      if (res.ok) {
        await fetchBackupFiles();
      }
    } catch (err) {
      console.error('Failed to cleanup backups', err);
    } finally {
      isBackupWorking = false;
    }
  };

  const handleDeleteAllBackups = async () => {
    if (!confirm($t('settings.backup_management.delete_all_confirm'))) return;
    await cleanupBackups('all');
  };

  const handleDeleteExceptRecent = async () => {
    if (
      !confirm(
        $t('settings.backup_management.delete_except_recent_confirm', { values: { count: 3 } }),
      )
    )
      return;
    await cleanupBackups('keep_recent', 3);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Dialog State
  let dialog = $state({
    open: false,
    title: '',
    message: '',
    confirmText: undefined as string | undefined,
    variant: 'primary' as 'primary' | 'danger' | 'success',
    loading: false,
    loadingText: undefined as string | undefined,
    showCancel: true,
    onConfirm: async () => {},
  });

  const closeDialog = () => {
    dialog.open = false;
  };

  const showAlertDialog = (
    title: string,
    message: string,
    variant: 'danger' | 'success' = 'danger',
  ) => {
    dialog.title = title;
    dialog.message = message;
    dialog.variant = variant;
    dialog.showCancel = false;
    dialog.confirmText = $t('common.confirm');
    dialog.loading = false;
    dialog.onConfirm = async () => {
      closeDialog();
    };
    dialog.open = true;
  };

  const showConfirmDialog = ({
    title,
    message,
    confirmText,
    variant = 'primary',
    loadingText,
    action,
    onSuccess,
  }: {
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'primary' | 'danger' | 'success';
    loadingText?: string;
    action: () => Promise<void>;
    onSuccess?: () => void;
  }) => {
    dialog.title = title;
    dialog.message = message;
    dialog.confirmText = confirmText;
    dialog.variant = variant;
    dialog.loadingText = loadingText;
    dialog.showCancel = true;
    dialog.loading = false;
    dialog.onConfirm = async () => {
      dialog.loading = true;
      try {
        await action();
        // If onSuccess handles closing or reloading, let it do so.
        // Otherwise close.
        if (onSuccess) {
          // If onSuccess is async (e.g. reload), keeps loading?
          // Simple version:
          closeDialog();
          onSuccess();
        } else {
          closeDialog();
        }
      } catch (err: any) {
        closeDialog();
        // Show error dialog
        setTimeout(() => {
          showAlertDialog(
            $t('common.error') || 'Error',
            err.message || 'An error occurred',
            'danger',
          );
        }, 300);
      } finally {
        if (!onSuccess) dialog.loading = false;
      }
    };
    dialog.open = true;
  };

  // Application Control
  let isRestarting = $state(false);
  let isClearingMqtt = $state(false);

  async function triggerMqttCleanup() {
    isClearingMqtt = true;
    const res = await fetch('./api/mqtt/cleanup', {
      method: 'POST',
    });

    if (!res.ok) {
      isClearingMqtt = false;
      const err = await res.json();
      throw new Error(err.error || 'Cleanup failed');
    }

    // Cleanup successful
    const data = await res.json();
    isClearingMqtt = false;

    // Show success message or just reload?
    // The API triggers a restart anyway after 1s.
    // Let's show a success dialog or auto-reload.
    // The restart will cause a reload eventually if the user is polling or connection is lost.
    // But let's be explicit.

    // Actually, triggerSystemRestart handles reload.
    // Here we can just show a success alert or let the restart take over.
    // Wait for the restart effect.
    setTimeout(() => {
      window.location.reload();
    }, 5000);
  }

  function handleClearMqtt() {
    showConfirmDialog({
      title: $t('settings.app_control.mqtt_cleanup'),
      message: $t('settings.app_control.mqtt_cleanup_confirm'),
      confirmText: $t('settings.app_control.mqtt_cleanup'),
      variant: 'danger',
      loadingText: $t('settings.app_control.cleaning'),
      action: triggerMqttCleanup,
      onSuccess: () => {
        dialog.loading = true;
        dialog.open = true;
        dialog.title = $t('settings.app_control.restarting');
        dialog.message = $t('settings.app_control.mqtt_cleanup_success');
        dialog.loadingText = $t('settings.app_control.restarting');
      },
    });
  }

  async function triggerSystemRestart() {
    isRestarting = true;
    // 1. Get One-time Token
    const tokenRes = await fetch('./api/system/restart/token');
    if (!tokenRes.ok) throw new Error('Failed to get restart token');
    const { token } = await tokenRes.json();

    // 2. Send Restart Request with Token
    const res = await fetch('./api/system/restart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Restart failed');
    }

    // Auto-reload after 5 seconds
    setTimeout(() => {
      window.location.reload();
    }, 5000);
  }

  function handleRestart() {
    showConfirmDialog({
      title: $t('settings.app_control.restart'),
      message: $t('settings.app_control.restart_confirm'),
      confirmText: $t('settings.app_control.restart'),
      variant: 'danger',
      loadingText: $t('settings.app_control.restarting'),
      action: triggerSystemRestart,
      onSuccess: () => {
        // Keep things spinning or just reload?
        // triggerSystemRestart sets isRestarting=true and does reload itself.
        // But here we are inside dialog callback.
        // We want the dialog to stay open with "Restarting..." until reload?
        // Yes.
        isRestarting = true; // ensure state
        dialog.loading = true;
        dialog.open = true; // Keep it open
      },
    });
  }

  let deletingConfig = $state<string | null>(null);
  let isLastBridge = $derived((bridgeInfo?.bridges?.length ?? 0) === 1);

  const handleDeleteConfig = async (filename: string) => {
    // 마지막 브릿지 삭제 시 특별 경고 메시지 표시
    const message = isLastBridge
      ? $t('settings.bridge_config.delete_last_confirm', { values: { filename } })
      : $t('settings.bridge_config.delete_confirm', { values: { filename } });

    showConfirmDialog({
      title: $t('common.delete'),
      message,
      confirmText: $t('common.delete'),
      variant: 'danger',
      loadingText: $t('settings.bridge_config.restarting'),
      action: async () => {
        deletingConfig = filename;
        const res = await fetch(`./api/config/files/${filename}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          await triggerSystemRestart();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Delete failed');
        }
      },
      onSuccess: () => {
        // Restart is triggered, just keep it open
        dialog.loading = true;
        dialog.open = true;
      },
    });
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

  <Dialog
    open={dialog.open}
    title={dialog.title}
    message={dialog.message}
    confirmText={dialog.confirmText}
    variant={dialog.variant}
    loading={dialog.loading}
    loadingText={dialog.loadingText}
    showCancel={dialog.showCancel}
    onconfirm={dialog.onConfirm}
    oncancel={closeDialog}
  />

  {#if showAddBridgeModal}
    <SetupWizard mode="add" onclose={() => (showAddBridgeModal = false)} />
  {/if}

  {#if editingConfigFile}
    <BridgeConfigEditorModal
      filename={editingConfigFile}
      onclose={() => (editingConfigFile = null)}
      onrestart={triggerSystemRestart}
      onsave={() => {
        // Config saved, user should restart
      }}
    />
  {/if}

  <div class="view-header">
    <h1>{$t('settings.title')}</h1>
    <div class="lang-switcher">
      <select
        value={$locale}
        onchange={handleLocaleChange}
        disabled={isSaving || isLoading}
        aria-label={$t('common.language')}
      >
        {#each $locales as l (l)}
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
          <div class="setting-title" id="toast-state-title">
            {$t('settings.toast.state_change.title')}
          </div>
          <div class="setting-desc" id="toast-state-desc">
            {$t('settings.toast.state_change.desc')}
          </div>
        </div>
        <Toggle
          checked={getToastValue('stateChange')}
          onchange={(checked) => onToastChange?.('stateChange', checked)}
          disabled={isSaving || isLoading}
          ariaLabelledBy="toast-state-title"
          ariaDescribedBy="toast-state-desc"
        />
      </div>

      <div class="setting">
        <div>
          <div class="setting-title" id="toast-command-title">
            {$t('settings.toast.command.title')}
          </div>
          <div class="setting-desc" id="toast-command-desc">
            {$t('settings.toast.command.desc')}
          </div>
        </div>
        <Toggle
          checked={getToastValue('command')}
          onchange={(checked) => onToastChange?.('command', checked)}
          disabled={isSaving || isLoading}
          ariaLabelledBy="toast-command-title"
          ariaDescribedBy="toast-command-desc"
        />
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
          <div class="setting-title" id="log-sharing-title">
            {$t('settings.log_sharing.enable')}
          </div>
        </div>
        <Toggle
          checked={logSharingStatus.consented}
          onchange={(checked) => handleLogSharingToggle(checked)}
          ariaLabelledBy="log-sharing-title"
        />
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
          <div class="setting-title" id="log-retention-title">
            {$t('settings.log_retention.enable')}
          </div>
          <div class="setting-desc" id="log-retention-desc">
            {$t('settings.log_retention.enable_desc')}
          </div>
        </div>
        <Toggle
          checked={cacheSettings.enabled}
          onchange={(checked) => updateCacheSettings({ enabled: checked })}
          disabled={isCacheSaving}
          ariaLabelledBy="log-retention-title"
          ariaDescribedBy="log-retention-desc"
        />
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

        <div class="setting sub-setting">
          <div>
            <div class="setting-title">{$t('settings.log_retention.ttl')}</div>
            <div class="setting-desc">{$t('settings.log_retention.ttl_desc')}</div>
          </div>
          <input
            type="number"
            class="number-input"
            min="1"
            max="168"
            value={cacheSettings.ttlHours}
            onchange={handleTtlChange}
            disabled={isCacheSaving}
          />
        </div>

        <div class="setting">
          <div>
            <div class="setting-title">{$t('settings.log_retention.manual_save')}</div>
            <div class="setting-desc">{$t('settings.log_retention.manual_save_desc')}</div>
          </div>
          <Button
            onclick={handleManualSave}
            isLoading={isCacheSaving}
            disabled={isCacheSaving}
            variant="secondary"
          >
            {$t('settings.log_retention.save_now')}
          </Button>
        </div>

        <div class="setting">
          <div>
            <div class="setting-title" id="auto-save-title">
              {$t('settings.log_retention.auto_save')}
            </div>
            <div class="setting-desc" id="auto-save-desc">
              {$t('settings.log_retention.auto_save_desc', {
                values: { ttl: cacheSettings.ttlHours },
              })}
            </div>
          </div>
          <Toggle
            checked={cacheSettings.autoSaveEnabled}
            onchange={(checked) => updateCacheSettings({ autoSaveEnabled: checked })}
            disabled={isCacheSaving}
            ariaLabelledBy="auto-save-title"
            ariaDescribedBy="auto-save-desc"
          />
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
          {#if shouldCollapseCacheFiles}
            <details class="files-collapse" bind:open={cacheFilesOpen}>
              <summary class="collapse-summary">
                <span>
                  {cacheFilesOpen
                    ? $t('settings.log_retention.hide_files')
                    : $t('settings.log_retention.show_files', {
                        values: { count: cacheFiles.length.toLocaleString() },
                      })}
                </span>
                <span class="count-badge">{cacheFiles.length.toLocaleString()}</span>
              </summary>
              <div class="files-list">
                {#each cacheFiles as file (file.filename)}
                  <div class="file-row">
                    <span class="file-name">{file.filename}</span>
                    <span class="file-size">{formatBytes(file.size)}</span>
                    <div class="file-actions">
                      <Button
                        variant="secondary"
                        class="file-action-btn"
                        onclick={() => downloadCacheFile(file.filename)}
                        ariaLabel={$t('settings.log_retention.download')}
                        title={$t('settings.log_retention.download')}
                      >
                        ⬇
                      </Button>
                      <Button
                        variant="danger"
                        class="file-action-btn"
                        onclick={() => deleteCacheFile(file.filename)}
                        isLoading={deletingFile === file.filename}
                        ariaLabel={$t('settings.log_retention.delete')}
                        title={$t('settings.log_retention.delete')}
                      >
                        🗑
                      </Button>
                    </div>
                  </div>
                {/each}
              </div>
              {#if downloadError}
                <div class="setting-desc warning">{downloadError}</div>
              {/if}
            </details>
          {:else}
            <div class="files-list">
              {#each cacheFiles as file (file.filename)}
                <div class="file-row">
                  <span class="file-name">{file.filename}</span>
                  <span class="file-size">{formatBytes(file.size)}</span>
                  <div class="file-actions">
                    <Button
                      variant="secondary"
                      class="file-action-btn"
                      onclick={() => downloadCacheFile(file.filename)}
                      ariaLabel={$t('settings.log_retention.download')}
                      title={$t('settings.log_retention.download')}
                    >
                      ⬇
                    </Button>
                    <Button
                      variant="danger"
                      class="file-action-btn"
                      onclick={() => deleteCacheFile(file.filename)}
                      isLoading={deletingFile === file.filename}
                      ariaLabel={$t('settings.log_retention.delete')}
                      title={$t('settings.log_retention.delete')}
                    >
                      🗑
                    </Button>
                  </div>
                </div>
              {/each}
            </div>
            {#if downloadError}
              <div class="setting-desc warning">{downloadError}</div>
            {/if}
          {/if}
        </div>
      {:else if cacheSettings.autoSaveEnabled}
        <div class="setting sub-setting">
          <div class="setting-desc muted">{$t('settings.log_retention.no_files')}</div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Backup Management Card -->
  <div class="card">
    <div class="card-header">
      <div>
        <h2>{$t('settings.backup_management.title')}</h2>
        <p>{$t('settings.backup_management.desc')}</p>
      </div>
    </div>

    <div class="setting">
      <div>
        <div class="setting-title">{$t('settings.backup_management.total_usage')}</div>
        <div class="setting-desc stats">
          <span class="stat-value">{formatBytes(backupTotalSize)}</span>
          <span class="stat-detail">
            {$t('settings.backup_management.file_count', {
              values: { count: backupFiles.length.toLocaleString() },
            })}
          </span>
        </div>
      </div>
      <div class="setting-actions">
        <Button
          variant="secondary"
          onclick={handleDeleteExceptRecent}
          isLoading={isBackupWorking}
          disabled={isBackupWorking || backupFiles.length <= 3}
        >
          {$t('settings.backup_management.delete_except_recent', { values: { count: 3 } })}
        </Button>
        <Button
          variant="danger"
          onclick={handleDeleteAllBackups}
          isLoading={isBackupWorking}
          disabled={isBackupWorking || backupFiles.length === 0}
        >
          {$t('settings.backup_management.delete_all')}
        </Button>
      </div>
    </div>

    {#if backupFiles.length > 0}
      <div class="setting files-section">
        <div class="setting-title">{$t('settings.backup_management.saved_files')}</div>
        {#if shouldCollapseBackupFiles}
          <details class="files-collapse" bind:open={backupFilesOpen}>
            <summary class="collapse-summary">
              <span>
                {backupFilesOpen
                  ? $t('settings.backup_management.hide_files')
                  : $t('settings.backup_management.show_files', {
                      values: { count: backupFiles.length.toLocaleString() },
                    })}
              </span>
              <span class="count-badge">{backupFiles.length.toLocaleString()}</span>
            </summary>
            <div class="files-list">
              {#each backupFiles as file (file.filename)}
                <div class="file-row">
                  <span class="file-name">{file.filename}</span>
                  <span class="file-size">{formatBytes(file.size)}</span>
                  <div class="file-actions">
                    <Button
                      variant="secondary"
                      class="file-action-btn"
                      onclick={() => downloadBackupFile(file.filename)}
                      ariaLabel={$t('settings.backup_management.download')}
                      title={$t('settings.backup_management.download')}
                    >
                      ⬇
                    </Button>
                    <Button
                      variant="danger"
                      class="file-action-btn"
                      onclick={() => deleteBackupFile(file.filename)}
                      isLoading={deletingBackup === file.filename}
                      ariaLabel={$t('settings.backup_management.delete')}
                      title={$t('settings.backup_management.delete')}
                    >
                      🗑
                    </Button>
                  </div>
                </div>
              {/each}
            </div>
            {#if backupDownloadError}
              <div class="setting-desc warning">{backupDownloadError}</div>
            {/if}
          </details>
        {:else}
          <div class="files-list">
            {#each backupFiles as file (file.filename)}
              <div class="file-row">
                <span class="file-name">{file.filename}</span>
                <span class="file-size">{formatBytes(file.size)}</span>
                <div class="file-actions">
                  <Button
                    variant="secondary"
                    class="file-action-btn"
                    onclick={() => downloadBackupFile(file.filename)}
                    ariaLabel={$t('settings.backup_management.download')}
                    title={$t('settings.backup_management.download')}
                  >
                    ⬇
                  </Button>
                  <Button
                    variant="danger"
                    class="file-action-btn"
                    onclick={() => deleteBackupFile(file.filename)}
                    isLoading={deletingBackup === file.filename}
                    ariaLabel={$t('settings.backup_management.delete')}
                    title={$t('settings.backup_management.delete')}
                  >
                    🗑
                  </Button>
                </div>
              </div>
            {/each}
          </div>
          {#if backupDownloadError}
            <div class="setting-desc warning">{backupDownloadError}</div>
          {/if}
        {/if}
      </div>
    {:else}
      <div class="setting sub-setting">
        <div class="setting-desc muted">{$t('settings.backup_management.no_files')}</div>
      </div>
    {/if}
  </div>

  <!-- Bridge Config Card -->
  <div class="card">
    <div class="card-header">
      <div>
        <h2>{$t('settings.bridge_config.title')}</h2>
      </div>
    </div>

    <div class="setting">
      <div>
        <div class="setting-title">
          {$t('settings.bridge_config.add_title')}
        </div>
        <div class="setting-desc">
          {$t('settings.bridge_config.add_desc')}
        </div>
      </div>
      <Button onclick={() => (showAddBridgeModal = true)}>
        {$t('settings.bridge_config.add_button')}
      </Button>
    </div>

    {#if bridgeInfo?.bridges && bridgeInfo.bridges.length > 0}
      <div class="setting sub-setting list">
        <div class="setting-title">{$t('settings.bridge_config.current_configs')}</div>
        <div class="files-list">
          {#each bridgeInfo.bridges as bridge (bridge.configFile)}
            <div class="file-row">
              <div class="bridge-info">
                <span class="file-name">{bridge.configFile}</span>
                <div class="bridge-details">
                  {#if bridge.serial}
                    <span class="badge sm">{bridge.serial.portId}: {bridge.serial.path}</span>
                  {/if}
                </div>
              </div>

              <div class="file-actions">
                <Button
                  variant="secondary"
                  class="file-action-btn"
                  onclick={() => (editingConfigFile = bridge.configFile)}
                  ariaLabel={$t('settings.bridge_config.edit_button')}
                  title={$t('settings.bridge_config.edit_button')}
                >
                  ✏️
                </Button>
                <Button
                  variant="danger"
                  class="file-action-btn"
                  onclick={() => handleDeleteConfig(bridge.configFile)}
                  isLoading={deletingConfig === bridge.configFile}
                  ariaLabel={$t('common.delete')}
                  title={isLastBridge
                    ? $t('settings.bridge_config.delete_last_warning')
                    : $t('common.delete')}
                >
                  🗑
                </Button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- Application Control Card -->
  <div class="card">
    <div class="card-header">
      <div>
        <h2>{$t('settings.app_control.title')}</h2>
      </div>
    </div>

    <div class="setting">
      <div>
        <div class="setting-title">{$t('settings.app_control.restart')}</div>
        <div class="setting-desc">{$t('settings.app_control.restart_desc')}</div>
      </div>
      <Button
        variant="danger"
        onclick={handleRestart}
        isLoading={isRestarting}
        disabled={isRestarting}
      >
        {$t('settings.app_control.restart')}
      </Button>
    </div>

    <div class="setting">
      <div>
        <div class="setting-title">{$t('settings.app_control.mqtt_cleanup')}</div>
        <div class="setting-desc">{$t('settings.app_control.mqtt_cleanup_desc')}</div>
      </div>
      <Button
        onclick={handleClearMqtt}
        variant="danger"
        isLoading={isClearingMqtt}
        disabled={isClearingMqtt || isRestarting}
      >
        {$t('settings.app_control.mqtt_cleanup')}
      </Button>
    </div>
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
    gap: 1rem;
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

  .setting-desc.warning {
    color: #facc15;
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

  .files-section,
  .setting.list {
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

  .files-collapse {
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 10px;
    padding: 0.75rem;
    background: rgba(15, 23, 42, 0.35);
  }

  .collapse-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    font-weight: 600;
    color: #e2e8f0;
    list-style: none;
  }

  .collapse-summary::-webkit-details-marker {
    display: none;
  }

  .count-badge {
    background: rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    font-size: 0.75rem;
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

  .bridge-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .bridge-details {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .badge.sm {
    font-size: 0.75rem;
    padding: 0.1rem 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
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

  .setting-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  :global(.file-action-btn) {
    padding: 0.4rem 0.6rem !important;
    line-height: 1;
    font-size: 1rem;
  }

  @media (max-width: 480px) {
    .view-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .lang-switcher {
      width: 100%;
    }

    .lang-switcher select {
      width: 100%;
    }

    .card {
      padding: 1rem;
    }

    .setting {
      padding: 0.75rem 0;
      gap: 0.75rem;
    }

    .setting-title {
      font-size: 0.95rem;
    }

    .setting-desc {
      font-size: 0.85rem;
    }
  }
</style>
