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
  import { triggerSystemRestart as restartApp } from '../utils/appControl';

  type ToastSettingKey = 'stateChange' | 'command';

  let {
    frontendSettings = null,
    bridgeInfo = null,
    isLoading = false,
    isSaving = false,
    error = '',
    onToastChange,
    onActivityLogChange,
    onLocaleChange,
    onEditorChange,
    onDashboardChange,
    onAutoRestartChange,
    onGalleryChange,
  }: {
    frontendSettings?: FrontendSettings | null;
    bridgeInfo?: BridgeInfo | null;
    isLoading?: boolean;
    isSaving?: boolean;
    error?: string;
    onToastChange?: (key: ToastSettingKey, value: boolean) => void;
    onActivityLogChange?: (value: boolean) => void;
    onLocaleChange?: (value: string) => void;
    onEditorChange?: (value: 'monaco' | 'textarea') => void;
    onDashboardChange?: (value: boolean) => void;
    onAutoRestartChange?: (value: {
      enabled: boolean;
      timeoutMinutes: number;
      processFallback?: boolean;
    }) => void;
    onGalleryChange?: (value: { githubUrl: string; branch: string; path: string }) => void;
  } = $props();

  let galleryGithubUrl = $state('');
  let galleryBranch = $state('');
  let galleryPath = $state('');

  $effect(() => {
    if (frontendSettings?.gallery) {
      galleryGithubUrl = frontendSettings.gallery.githubUrl || '';
      galleryBranch = frontendSettings.gallery.branch || '';
      galleryPath = frontendSettings.gallery.path || '';
    }
  });

  const handleGallerySave = () => {
    onGalleryChange?.({
      githubUrl: galleryGithubUrl,
      branch: galleryBranch,
      path: galleryPath,
    });
  };

  const resetGalleryToDefault = () => {
    galleryGithubUrl = 'https://github.com/wooooooooooook/homenet2mqtt';
    galleryBranch = 'main';
    galleryPath = 'gallery';
  };

  const getAutoRestartSettings = () => {
    return (
      frontendSettings?.autoRestart ?? {
        enabled: true,
        timeoutMinutes: 5,
        processFallback: false,
      }
    );
  };

  const handleAutoRestartToggle = (checked: boolean) => {
    const current = getAutoRestartSettings();
    onAutoRestartChange?.({ ...current, enabled: checked });
  };

  const handleAutoRestartFallbackToggle = (checked: boolean) => {
    const current = getAutoRestartSettings();
    onAutoRestartChange?.({ ...current, processFallback: checked });
  };

  const handleAutoRestartTimeoutChange = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const timeoutMinutes = Number.parseInt(target.value, 10);
    if (Number.isNaN(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 1440) {
      return;
    }

    const current = getAutoRestartSettings();
    onAutoRestartChange?.({ ...current, timeoutMinutes });
  };

  const getToastValue = (key: ToastSettingKey) => {
    return frontendSettings?.toast?.[key] ?? true;
  };

  const getActivityLogValue = () => {
    return frontendSettings?.activityLog?.hideAutomationScripts ?? false;
  };

  const showMqttCleanup = $derived(
    (bridgeInfo?.bridges?.[0]?.integrationType ?? 'mqtt') !== 'matter',
  );

  const handleToggle = (key: ToastSettingKey, event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    onToastChange?.(key, target.checked);
  };

  const handleLocaleChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement;
    onLocaleChange?.(target.value);
  };

  // Log Sharing State
  let logSharingStatus = $state<{
    asked: boolean;
    consented: boolean;
    uid?: string | null;
    isCollecting?: boolean;
    packetCount?: number;
  } | null>(null);
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
  let isCacheWorking = $state(false);
  let deletingFile = $state<string | null>(null);
  let downloadError = $state<string | null>(null);
  const logFileCollapseThreshold = 5;
  let cacheFilesOpen = $state(false);
  const cacheTotalSize = $derived(cacheFiles.reduce((sum, f) => sum + f.size, 0));

  let backupFiles = $state<BackupFile[]>([]);
  let backupTotalSize = $state(0);
  let isBackupWorking = $state(false);
  let deletingBackup = $state<string | null>(null);
  let backupDownloadError = $state<string | null>(null);
  const backupFileCollapseThreshold = 5;
  let backupFilesOpen = $state(false);

  // Packet log files state
  let packetLogFiles = $state<SavedLogFile[]>([]);
  let packetLogTotalSize = $state(0);
  let isPacketLogWorking = $state(false);
  let deletingPacketLog = $state<string | null>(null);
  let packetLogDownloadError = $state<string | null>(null);
  const packetLogCollapseThreshold = 5;
  let packetLogFilesOpen = $state(false);

  const shouldCollapseCacheFiles = $derived(cacheFiles.length > logFileCollapseThreshold);
  const shouldCollapseBackupFiles = $derived(backupFiles.length > backupFileCollapseThreshold);
  const shouldCollapsePacketLogFiles = $derived(packetLogFiles.length > packetLogCollapseThreshold);

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

  const fetchPacketLogFiles = async () => {
    try {
      const res = await fetch(`./api/logs/packet/files?_=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        packetLogFiles = data.files || [];
        packetLogTotalSize = data.totalSize || 0;
      }
    } catch (err) {
      console.error('Failed to fetch packet log files', err);
    }
  };

  $effect(() => {
    fetchCacheSettings();
    fetchCacheStats();
    fetchCacheFiles();
    fetchBackupFiles();
    fetchPacketLogFiles();

    // Refresh stats every 30 seconds if caching is enabled
    const interval = setInterval(() => {
      if (cacheSettings?.enabled) {
        fetchCacheStats();
      }
    }, 30000);

    return () => clearInterval(interval);
  });

  // 빠른 폴링: 로그 및 데이터 수집 중일 때 1초 간격으로 진행률 업데이트
  $effect(() => {
    if (!logSharingStatus?.consented) return;

    const interval = setInterval(() => {
      fetchLogSharingStatus();
    }, 1000);

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

  const cleanupCacheFiles = async (mode: 'all' | 'keep_recent', keepCount = 3) => {
    isCacheWorking = true;
    try {
      const res = await fetch('./api/logs/cache/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, keepCount }),
      });
      if (res.ok) {
        await fetchCacheFiles();
      }
    } catch (err) {
      console.error('Failed to cleanup cache files', err);
    } finally {
      isCacheWorking = false;
    }
  };

  const handleDeleteAllCacheFiles = async () => {
    if (!confirm($t('settings.log_retention.delete_all_confirm'))) return;
    await cleanupCacheFiles('all');
  };

  const handleDeleteExceptRecentCacheFiles = async () => {
    if (
      !confirm($t('settings.log_retention.delete_except_recent_confirm', { values: { count: 3 } }))
    )
      return;
    await cleanupCacheFiles('keep_recent', 3);
  };

  // Packet log file management functions
  const downloadPacketLogFile = (filename: string) => {
    packetLogDownloadError = null;
    const isHAAppName = navigator.userAgent.includes('Home Assistant');
    const link = document.createElement('a');
    link.href = `./api/logs/packet/download/${filename}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (isHAAppName) {
      setTimeout(() => {
        packetLogDownloadError = $t('analysis.raw_log.ha_app_download_warning');
      }, 500);
    }
  };

  const deletePacketLogFile = async (filename: string) => {
    if (!confirm($t('settings.log_retention.packet_log.delete_confirm'))) return;

    deletingPacketLog = filename;
    try {
      const res = await fetch(`./api/logs/packet/${filename}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchPacketLogFiles();
      }
    } catch (err) {
      console.error('Failed to delete packet log file', err);
    } finally {
      deletingPacketLog = null;
    }
  };

  const cleanupPacketLogFiles = async (mode: 'all' | 'keep_recent', keepCount = 3) => {
    isPacketLogWorking = true;
    try {
      const res = await fetch('./api/logs/packet/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, keepCount }),
      });
      if (res.ok) {
        await fetchPacketLogFiles();
      }
    } catch (err) {
      console.error('Failed to cleanup packet log files', err);
    } finally {
      isPacketLogWorking = false;
    }
  };

  const handleDeleteAllPacketLogFiles = async () => {
    if (!confirm($t('settings.log_retention.packet_log.delete_all_confirm'))) return;
    await cleanupPacketLogFiles('all');
  };

  const handleDeleteExceptRecentPacketLogFiles = async () => {
    if (
      !confirm(
        $t('settings.log_retention.packet_log.delete_except_recent_confirm', {
          values: { count: 3 },
        }),
      )
    )
      return;
    await cleanupPacketLogFiles('keep_recent', 3);
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
    onSuccess?: () => void | Promise<void>;
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
        if (onSuccess) {
          await onSuccess();
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

    // Ensure the dialog shows "Restarting..." feedback
    // This handles calls from child components (BridgeConfigEditorModal)
    // and updates the existing dialog if already open (handleRestart, handleDeleteConfig)
    dialog.title = $t('settings.app_control.restart');
    dialog.message = $t('settings.app_control.restarting');
    dialog.loadingText = $t('settings.app_control.restarting');
    dialog.variant = 'primary';
    dialog.showCancel = false;
    dialog.loading = true;
    dialog.open = true;

    await restartApp();
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
        isRestarting = true; // ensure state
        dialog.loading = true;
        dialog.open = true; // Keep it open
      },
    });
  }

  let deletingConfig = $state<string | null>(null);
  let isLastBridge = $derived((bridgeInfo?.bridges?.length ?? 0) === 1);

  const handleEditorChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement;
    const value = target.value as 'monaco' | 'textarea';
    onEditorChange?.(value);
  };

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

  let activeSection = $state<string>('bridge-config');
  const settingSections = [
    'bridge-config',
    'dashboard-settings',
    'log-settings',
    'backup-management',
    'gallery-config',
    'app-control',
  ];

  $effect(() => {
    const rootEl = document.querySelector('.main-content');
    if (!rootEl) return;

    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      const intersecting = entries.filter((e) => e.isIntersecting);
      if (intersecting.length > 0) {
        intersecting.sort(
          (a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top),
        );
        activeSection = intersecting[0].target.id;
      }
    };

    const observer = new IntersectionObserver(handleIntersect, {
      root: rootEl,
      rootMargin: '-80px 0px -60% 0px', // Target active viewport zone below mobile sticky bar
      threshold: 0,
    });

    const timer = setTimeout(() => {
      settingSections.forEach((id) => {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      });
    }, 150);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  });

  const handleAnchorClick = (event: MouseEvent, targetId: string) => {
    event.preventDefault();
    const element = document.getElementById(targetId);
    const container = document.querySelector('.main-content');
    const sidebar = document.querySelector('.settings-sidebar');

    if (element && container) {
      const containerScrollTop = container.scrollTop;
      const elementTop = element.getBoundingClientRect().top;
      const containerTop = container.getBoundingClientRect().top;

      const targetScrollTop = containerScrollTop + elementTop - containerTop;
      const isMobile = window.innerWidth <= 480;
      const offset = isMobile && sidebar ? (sidebar as HTMLElement).offsetHeight : 0;
      const margin = 16;

      container.scrollTo({
        top: targetScrollTop - offset - margin,
        behavior: 'smooth',
      });

      history.pushState(null, '', `#${targetId}`);
      activeSection = targetId;
    }
  };

  let isSidebarCollapsed = $state(false);
</script>

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
    mode={frontendSettings?.editor?.default ?? 'monaco'}
  />
{/if}

<section class="settings-view">
  <div class="view-header">
    <div class="header-main">
      <h1>{$t('settings.title')}</h1>
      {#if bridgeInfo?.version}
        <span class="version-badge" class:is-dev={bridgeInfo.version.startsWith('dev-')}>
          {bridgeInfo.version.startsWith('dev-') ? 'DEV ' : ''}v{bridgeInfo.version}
        </span>
      {/if}
    </div>
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

  <div class="settings-layout" class:sidebar-collapsed={isSidebarCollapsed}>
    <aside
      class="settings-sidebar"
      class:collapsed={isSidebarCollapsed}
      aria-label={$t('settings.title')}
    >
      <button
        type="button"
        class="sidebar-toggle-btn"
        onclick={() => (isSidebarCollapsed = !isSidebarCollapsed)}
        aria-label={isSidebarCollapsed ? 'Open settings sidebar' : 'Close settings sidebar'}
        title={isSidebarCollapsed ? 'Open settings sidebar' : 'Close settings sidebar'}
      >
        {#if isSidebarCollapsed}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg
          >
        {:else}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg
          >
        {/if}
      </button>
      <nav>
        <a
          href="#bridge-config"
          class:active={activeSection === 'bridge-config'}
          onclick={(e) => handleAnchorClick(e, 'bridge-config')}
          >{$t('settings.bridge_config.title')}</a
        >
        <a
          href="#dashboard-settings"
          class:active={activeSection === 'dashboard-settings'}
          onclick={(e) => handleAnchorClick(e, 'dashboard-settings')}
          >{$t('settings.dashboard.title')}</a
        >
        <a
          href="#log-settings"
          class:active={activeSection === 'log-settings'}
          onclick={(e) => handleAnchorClick(e, 'log-settings')}>{$t('settings.log.title')}</a
        >
        <a
          href="#backup-management"
          class:active={activeSection === 'backup-management'}
          onclick={(e) => handleAnchorClick(e, 'backup-management')}
          >{$t('settings.backup_management.title')}</a
        >
        <a
          href="#gallery-config"
          class:active={activeSection === 'gallery-config'}
          onclick={(e) => handleAnchorClick(e, 'gallery-config')}>{$t('settings.gallery.title')}</a
        >
        <a
          href="#app-control"
          class:active={activeSection === 'app-control'}
          onclick={(e) => handleAnchorClick(e, 'app-control')}>{$t('settings.app_control.title')}</a
        >
      </nav>
    </aside>

    <div class="settings-content">
      <!-- 1. Bridge Config Section -->
      <div class="settings-section card-bridge-config" id="bridge-config">
        <div class="section-header">
          <div>
            <h2>{$t('settings.bridge_config.title')}</h2>
            <p>{$t('settings.bridge_config.desc')}</p>
          </div>
        </div>
        <div class="card">
          {#if bridgeInfo?.bridges && bridgeInfo.bridges.length > 0}
            <div class="setting list">
              <div class="setting-title">{$t('settings.bridge_config.current_configs')}</div>
              <div class="files-list">
                {#each bridgeInfo.bridges as bridge (bridge.configFile)}
                  <div class="file-row">
                    <div class="bridge-info">
                      <span class="file-name">{bridge.configFile}</span>
                      <div class="bridge-details">
                        {#if bridge.serial}
                          {#if bridge.serial.isMissing}
                            <span class="badge sm danger"
                              >{$t('settings.bridge_config.missing_file')}</span
                            >
                          {:else}
                            <span class="badge sm"
                              >{bridge.serial.portId}: {bridge.serial.path}</span
                            >
                          {/if}
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
                        disabled={bridgeInfo?.envConfigFilesSource !== 'default'}
                        ariaLabel={$t('common.delete')}
                        title={bridgeInfo?.envConfigFilesSource !== 'default'
                          ? $t('settings.bridge_config.delete_disabled_custom_config')
                          : isLastBridge
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
        </div>
      </div>

      <!-- 2. Dashboard Settings Section -->
      <div class="settings-section card-dashboard" id="dashboard-settings">
        <div class="section-header">
          <div>
            <h2>{$t('settings.dashboard.title')}</h2>
            <p>{$t('settings.dashboard.desc')}</p>
          </div>
          {#if isSaving}
            <span class="badge">{$t('settings.saving')}</span>
          {/if}
        </div>
        <div class="card">
          {#if isLoading}
            <div class="loading">{$t('settings.loading')}</div>
          {:else}
            <div class="setting">
              <div>
                <div class="setting-title" id="dashboard-internal-title">
                  {$t('settings.dashboard.show_internal.title')}
                </div>
                <div class="setting-desc" id="dashboard-internal-desc">
                  {$t('settings.dashboard.show_internal.desc')}
                </div>
              </div>
              <Toggle
                checked={frontendSettings?.dashboard?.showInternal ?? false}
                onchange={(checked) => onDashboardChange?.(checked)}
                disabled={isSaving || isLoading}
                ariaLabelledBy="dashboard-internal-title"
                ariaDescribedBy="dashboard-internal-desc"
              />
            </div>
          {/if}
        </div>
      </div>

      <!-- 3. Log Settings Section (Unified logs) -->
      <div class="settings-section card-log" id="log-settings">
        <div class="section-header">
          <div>
            <h2>{$t('settings.log.title')}</h2>
            <p>{$t('settings.log.desc')}</p>
          </div>
          {#if isSaving || isCacheSaving}
            <span class="badge">{$t('settings.saving')}</span>
          {/if}
        </div>
        <div class="card">
          {#if isLoading}
            <div class="loading">{$t('settings.loading')}</div>
          {:else}
            <!-- 3-1. Activity Log Setting (General Setting Item) -->
            <div class="setting" id="activity-log-settings">
              <div>
                <div class="setting-title" id="activity-log-hide-title">
                  {$t('settings.activity_log.hide_automation_scripts.title')}
                </div>
                <div class="setting-desc" id="activity-log-hide-desc">
                  {$t('settings.activity_log.hide_automation_scripts.desc')}
                </div>
              </div>
              <Toggle
                checked={getActivityLogValue()}
                onchange={(checked) => onActivityLogChange?.(checked)}
                disabled={isSaving || isLoading}
                ariaLabelledBy="activity-log-hide-title"
                ariaDescribedBy="activity-log-hide-desc"
              />
            </div>

            {#if !logSharingStatus}
              <div class="loading">{$t('settings.loading')}</div>
            {:else}
              <div class="setting" id="log-sharing-settings">
                <div>
                  <div class="setting-title" id="log-sharing-title">
                    {$t('settings.log_sharing.title')}
                  </div>
                  <div class="setting-desc" id="log-sharing-desc">
                    {$t('settings.log_sharing.desc')}
                  </div>
                  {#if logSharingStatus.consented}
                    <div
                      class="setting-desc emphasis text-primary"
                      style="color: #3b82f6; font-weight: 600; margin-top: 0.25rem;"
                    >
                      {$t('settings.log_sharing.collecting', {
                        values: { count: logSharingStatus.packetCount ?? 0 },
                      })}
                    </div>
                  {/if}
                  {#if logSharingStatus.uid}
                    <div
                      class="setting-desc"
                      style="margin-top: 0.5rem; font-size: 0.8rem; color: #64748b;"
                    >
                      {$t('settings.log_sharing.uid_desc', {
                        values: { uid: logSharingStatus.uid },
                      })}
                    </div>
                  {/if}
                </div>
                <Button
                  onclick={() => {
                    showConsentModal = true;
                  }}
                  disabled={logSharingStatus.consented}
                  variant={logSharingStatus.consented ? 'secondary' : 'primary'}
                >
                  {#if logSharingStatus.consented}
                    {$t('settings.log_sharing.collecting', {
                      values: { count: logSharingStatus.packetCount ?? 0 },
                    })}
                  {:else}
                    {$t('settings.log_sharing.send')}
                  {/if}
                </Button>
              </div>
            {/if}
          {/if}

          <!-- 3-2. Log Retention Sub-section -->
          <div class="subsection-header" id="log-retention-settings">
            <div>
              <h3>{$t('settings.log_retention.title')}</h3>
              <p>{$t('settings.log_retention.desc')}</p>
            </div>
          </div>
          <div class="setting-subsection">
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
                      <div class="setting-title">
                        {$t('settings.log_retention.retention_count')}
                      </div>
                      <div class="setting-desc">
                        {$t('settings.log_retention.retention_count_desc')}
                      </div>
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
                <div class="setting">
                  <div>
                    <div class="setting-title">{$t('settings.log_retention.total_usage')}</div>
                    <div class="setting-desc stats">
                      <span class="stat-value">{formatBytes(cacheTotalSize)}</span>
                      <span class="stat-detail">
                        {$t('settings.log_retention.file_count', {
                          values: { count: cacheFiles.length.toLocaleString() },
                        })}
                      </span>
                    </div>
                  </div>
                  <div class="setting-actions">
                    <Button
                      variant="secondary"
                      onclick={handleDeleteExceptRecentCacheFiles}
                      isLoading={isCacheWorking}
                      disabled={isCacheWorking || cacheFiles.length <= 3}
                    >
                      {$t('settings.log_retention.delete_except_recent', { values: { count: 3 } })}
                    </Button>
                    <Button
                      variant="danger"
                      onclick={handleDeleteAllCacheFiles}
                      isLoading={isCacheWorking}
                      disabled={isCacheWorking || cacheFiles.length === 0}
                    >
                      {$t('settings.log_retention.delete_all')}
                    </Button>
                  </div>
                </div>

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

          {#if packetLogFiles.length > 0}
            <div class="subsection-header" id="packet-log-settings">
              <div>
                <h3>{$t('settings.log_retention.packet_log.title')}</h3>
                <p>{$t('settings.log_retention.packet_log.desc')}</p>
              </div>
            </div>
            <div class="setting-subsection">
              <div class="setting">
                <div>
                  <div class="setting-title">
                    {$t('settings.log_retention.packet_log.total_usage')}
                  </div>
                  <div class="setting-desc stats">
                    <span class="stat-value">{formatBytes(packetLogTotalSize)}</span>
                    <span class="stat-detail">
                      {$t('settings.log_retention.packet_log.file_count', {
                        values: { count: packetLogFiles.length.toLocaleString() },
                      })}
                    </span>
                  </div>
                </div>
                <div class="setting-actions">
                  <Button
                    variant="secondary"
                    onclick={handleDeleteExceptRecentPacketLogFiles}
                    isLoading={isPacketLogWorking}
                    disabled={isPacketLogWorking || packetLogFiles.length <= 3}
                  >
                    {$t('settings.log_retention.packet_log.delete_except_recent', {
                      values: { count: 3 },
                    })}
                  </Button>
                  <Button
                    variant="danger"
                    onclick={handleDeleteAllPacketLogFiles}
                    isLoading={isPacketLogWorking}
                    disabled={isPacketLogWorking || packetLogFiles.length === 0}
                  >
                    {$t('settings.log_retention.packet_log.delete_all')}
                  </Button>
                </div>
              </div>

              <div class="setting files-section">
                <div class="setting-title">
                  {$t('settings.log_retention.packet_log.saved_files')}
                </div>
                {#if shouldCollapsePacketLogFiles}
                  <details class="files-collapse" bind:open={packetLogFilesOpen}>
                    <summary class="collapse-summary">
                      <span>
                        {packetLogFilesOpen
                          ? $t('settings.log_retention.packet_log.hide_files')
                          : $t('settings.log_retention.packet_log.show_files', {
                              values: { count: packetLogFiles.length.toLocaleString() },
                            })}
                      </span>
                      <span class="count-badge">{packetLogFiles.length.toLocaleString()}</span>
                    </summary>
                    <div class="files-list">
                      {#each packetLogFiles as file (file.filename)}
                        <div class="file-row">
                          <span class="file-name">{file.filename}</span>
                          <span class="file-size">{formatBytes(file.size)}</span>
                          <div class="file-actions">
                            <Button
                              variant="secondary"
                              class="file-action-btn"
                              onclick={() => downloadPacketLogFile(file.filename)}
                              ariaLabel={$t('settings.log_retention.packet_log.download')}
                              title={$t('settings.log_retention.packet_log.download')}
                            >
                              ⬇
                            </Button>
                            <Button
                              variant="danger"
                              class="file-action-btn"
                              onclick={() => deletePacketLogFile(file.filename)}
                              isLoading={deletingPacketLog === file.filename}
                              ariaLabel={$t('settings.log_retention.packet_log.delete')}
                              title={$t('settings.log_retention.packet_log.delete')}
                            >
                              🗑
                            </Button>
                          </div>
                        </div>
                      {/each}
                    </div>
                    {#if packetLogDownloadError}
                      <div class="setting-desc warning">{packetLogDownloadError}</div>
                    {/if}
                  </details>
                {:else}
                  <div class="files-list">
                    {#each packetLogFiles as file (file.filename)}
                      <div class="file-row">
                        <span class="file-name">{file.filename}</span>
                        <span class="file-size">{formatBytes(file.size)}</span>
                        <div class="file-actions">
                          <Button
                            variant="secondary"
                            class="file-action-btn"
                            onclick={() => downloadPacketLogFile(file.filename)}
                            ariaLabel={$t('settings.log_retention.packet_log.download')}
                            title={$t('settings.log_retention.packet_log.download')}
                          >
                            ⬇
                          </Button>
                          <Button
                            variant="danger"
                            class="file-action-btn"
                            onclick={() => deletePacketLogFile(file.filename)}
                            isLoading={deletingPacketLog === file.filename}
                            ariaLabel={$t('settings.log_retention.packet_log.delete')}
                            title={$t('settings.log_retention.packet_log.delete')}
                          >
                            🗑
                          </Button>
                        </div>
                      </div>
                    {/each}
                  </div>
                  {#if packetLogDownloadError}
                    <div class="setting-desc warning">{packetLogDownloadError}</div>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- 4. Backup Management Section -->
      <div class="settings-section card-backup" id="backup-management">
        <div class="section-header">
          <div>
            <h2>{$t('settings.backup_management.title')}</h2>
            <p>{$t('settings.backup_management.desc')}</p>
          </div>
        </div>
        <div class="card">
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
      </div>

      <!-- 5. Gallery Settings Section -->
      <div class="settings-section card-gallery" id="gallery-config">
        <div class="section-header">
          <div>
            <h2>{$t('settings.gallery.title')}</h2>
            <p>{$t('settings.gallery.desc')}</p>
          </div>
        </div>
        <div class="card">
          {#if isLoading}
            <div class="loading">{$t('settings.loading')}</div>
          {:else}
            <div class="setting sub-setting stack-vertical">
              <div>
                <div class="setting-title">{$t('settings.gallery.githubUrl')}</div>
                <div class="setting-desc">{$t('settings.gallery.githubUrl_desc')}</div>
              </div>
              <input
                type="text"
                class="text-input"
                bind:value={galleryGithubUrl}
                placeholder="https://github.com/wooooooooooook/homenet2mqtt"
                disabled={isSaving || isLoading}
              />
            </div>
            <div class="setting sub-setting stack-vertical">
              <div>
                <div class="setting-title">{$t('settings.gallery.branch')}</div>
                <div class="setting-desc">{$t('settings.gallery.branch_desc')}</div>
              </div>
              <input
                type="text"
                class="text-input"
                bind:value={galleryBranch}
                placeholder="main"
                disabled={isSaving || isLoading}
              />
            </div>
            <div class="setting sub-setting stack-vertical">
              <div>
                <div class="setting-title">{$t('settings.gallery.path')}</div>
                <div class="setting-desc">{$t('settings.gallery.path_desc')}</div>
              </div>
              <input
                type="text"
                class="text-input"
                bind:value={galleryPath}
                placeholder="gallery"
                disabled={isSaving || isLoading}
              />
            </div>
            <div class="setting" style="justify-content: flex-end; gap: 0.5rem;">
              <Button
                onclick={resetGalleryToDefault}
                disabled={isSaving || isLoading}
                variant="secondary"
              >
                {$t('settings.gallery.restore_defaults')}
              </Button>
              <Button
                onclick={handleGallerySave}
                disabled={isSaving || isLoading}
                variant="primary"
              >
                {$t('settings.gallery.save')}
              </Button>
            </div>
          {/if}
        </div>
      </div>

      <!-- 6. Application Control Section -->
      <div class="settings-section card-app-control" id="app-control">
        <div class="section-header">
          <h2>{$t('settings.app_control.title')}</h2>
        </div>
        <div class="card">
          <div class="setting">
            <div>
              <div class="setting-title">{$t('settings.app_control.editor_title')}</div>
              <div class="setting-desc">{$t('settings.app_control.editor_desc')}</div>
            </div>
            <select
              class="select"
              value={frontendSettings?.editor?.default ?? 'monaco'}
              onchange={handleEditorChange}
              disabled={isSaving}
            >
              <option
                value="monaco"
                selected={(frontendSettings?.editor?.default ?? 'monaco') === 'monaco'}
              >
                {$t('settings.app_control.editor_monaco')}
              </option>
              <option
                value="textarea"
                selected={(frontendSettings?.editor?.default ?? 'monaco') === 'textarea'}
              >
                {$t('settings.app_control.editor_textarea')}
              </option>
            </select>
          </div>

          <!-- Auto Restart Sub-section -->
          <div class="subsection-header">
            <div>
              <h3>{$t('settings.auto_restart.enabled.title')}</h3>
              <p>{$t('settings.auto_restart.enabled.desc')}</p>
            </div>
            <Toggle
              checked={getAutoRestartSettings().enabled}
              onchange={handleAutoRestartToggle}
              disabled={isSaving || isLoading}
              ariaLabelledBy="auto-restart-enabled-title"
              ariaDescribedBy="auto-restart-enabled-desc"
            />
          </div>
          <div class="setting-subsection">
            {#if isLoading}
              <div class="loading">{$t('settings.loading')}</div>
            {:else if getAutoRestartSettings().enabled}
              <div class="setting sub-setting">
                <div>
                  <div class="setting-title">{$t('settings.auto_restart.timeout.title')}</div>
                  <div class="setting-desc">{$t('settings.auto_restart.timeout.desc')}</div>
                </div>
                <input
                  type="number"
                  class="number-input"
                  min="1"
                  max="1440"
                  value={getAutoRestartSettings().timeoutMinutes}
                  onchange={handleAutoRestartTimeoutChange}
                  disabled={isSaving || isLoading}
                />
              </div>

              <div class="setting sub-setting">
                <div>
                  <div class="setting-title">
                    {$t('settings.auto_restart.process_fallback.title')}
                  </div>
                  <div class="setting-desc">
                    {$t('settings.auto_restart.process_fallback.desc')}
                  </div>
                </div>
                <Toggle
                  checked={getAutoRestartSettings().processFallback ?? false}
                  onchange={handleAutoRestartFallbackToggle}
                  disabled={isSaving || isLoading}
                />
              </div>
            {/if}
          </div>

          <!-- Toast Notification Sub-section -->
          <div class="subsection-header" id="toast-settings">
            <div>
              <h3>{$t('settings.toast.title')}</h3>
              <p>{$t('settings.toast.desc')}</p>
            </div>
          </div>
          <div class="setting-subsection">
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

          {#if showMqttCleanup}
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
          {/if}
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .settings-layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
    transition: grid-template-columns 0.3s ease;
  }

  .settings-layout.sidebar-collapsed {
    grid-template-columns: 16px minmax(0, 1fr);
  }

  .sidebar-toggle-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: -8px;
    width: 14px;
    height: 64px;
    border-radius: 4px;
    background: #1e293b;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    transition: all 0.2s ease;
    padding: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .sidebar-toggle-btn:hover {
    background: #334155;
    color: #f8fafc;
    border-color: rgba(148, 163, 184, 0.4);
  }

  .sidebar-toggle-btn svg {
    width: 10px;
    height: 10px;
  }

  .settings-sidebar {
    position: sticky;
    top: 1rem;
    height: calc(100vh - 230px);
    background: rgba(15, 23, 42, 0.4);
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 12px;
    padding: 0.75rem;
    transition: all 0.3s ease;
    box-sizing: border-box;
  }

  .settings-sidebar.collapsed {
    padding: 0;
    width: 16px;
    min-width: 16px;
    box-sizing: border-box;
    background: transparent;
    border: 1px solid transparent;
    border-right: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 0;
  }

  .settings-sidebar.collapsed nav {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 0.1s ease,
      visibility 0.1s ease;
  }

  .settings-sidebar nav {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    white-space: nowrap;
    opacity: 1;
    visibility: visible;
    transition:
      opacity 0.2s ease 0.15s,
      visibility 0.2s ease 0.15s;
    overflow: hidden;
    width: 100%;
  }

  .settings-sidebar a {
    color: #cbd5e1;
    text-decoration: none;
    font-size: 0.9rem;
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
    transition: all 0.15s ease;
    border-left: 3px solid transparent;
  }

  .settings-sidebar a:hover {
    background: rgba(148, 163, 184, 0.08);
  }

  .settings-sidebar a.active {
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
    font-weight: 500;
    border-left-color: #38bdf8;
    border-radius: 0 8px 8px 0;
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .card {
    scroll-margin-top: 1rem;
  }

  .card-bridge-config {
    order: 1;
  }

  .card-dashboard {
    order: 2;
  }

  .card-log {
    order: 3;
  }

  .card-backup {
    order: 4;
  }

  .card-gallery {
    order: 5;
  }

  .card-app-control {
    order: 6;
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

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.5rem;
    padding: 0 0.5rem;
  }

  .section-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: #f8fafc;
  }

  .section-header p {
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
    gap: 2rem;
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
  .number-input,
  .text-input {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    font-size: 0.95rem;
  }

  .number-input {
    width: 80px;
    text-align: center;
  }

  .text-input {
    width: 300px;
    max-width: 100%;
  }

  .number-input:focus,
  .text-input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.5);
  }

  .stack-vertical {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    justify-content: space-between;
  }

  @media (max-width: 600px) {
    .stack-vertical {
      flex-direction: column;
      align-items: flex-start;
    }
    .text-input {
      width: 100%;
    }
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

  .header-main {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .version-badge {
    font-size: 0.75rem;
    padding: 0.15rem 0.6rem;
    background: rgba(148, 163, 184, 0.1);
    color: #94a3b8;
    border-radius: 99px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    font-weight: 500;
  }

  .version-badge.is-dev {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%);
    color: #a78bfa;
    border-color: rgba(168, 85, 247, 0.3);
  }

  :global(.file-action-btn) {
    padding: 0.4rem 0.6rem !important;
    line-height: 1;
    font-size: 1rem;
  }

  @media (min-width: 769px) and (max-width: 1060px) {
    .settings-layout {
      grid-template-columns: 180px minmax(0, 1fr);
    }
    .settings-layout.sidebar-collapsed {
      grid-template-columns: 16px minmax(0, 1fr);
    }
  }

  @media (max-width: 480px) {
    .sidebar-toggle-btn {
      display: none;
    }

    .settings-layout {
      grid-template-columns: 1fr;
    }

    .settings-sidebar {
      position: sticky;
      top: -0.75rem;
      height: auto;
      z-index: 10;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(8px);
      margin: -0.75rem -0.75rem 1rem -0.75rem;
      padding: 0.75rem;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-top: none;
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    }

    .settings-sidebar nav {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .settings-sidebar a {
      font-size: 0.8rem;
      padding: 0.3rem 0.4rem;
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 8px;
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
    }

    .settings-sidebar a.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.4);
      border-left-color: transparent;
      border-radius: 8px;
    }

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
      scroll-margin-top: 10rem;
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

  .select {
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    font-size: 0.9rem;
    outline: none;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
    background-position: right 0.5rem center;
    background-repeat: no-repeat;
    background-size: 1.5em 1.5em;
    min-width: 200px;
  }

  .select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
  }

  .select option {
    background: #1e293b;
    color: #e2e8f0;
  }

  .setting-subsection {
    border: 1px solid rgba(148, 163, 184, 0.12);
    background: rgba(0, 0, 0, 0.15);
    border-radius: 12px;
    padding: 1.25rem;
    margin-top: 1rem;
  }

  .setting-subsection .setting {
    border-top: 1px solid rgba(148, 163, 184, 0.1);
    padding: 0.85rem 0;
  }

  .setting-subsection .setting:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  .setting-subsection .setting:last-of-type {
    padding-bottom: 0;
  }

  .subsection-header {
    border-top: 1px solid rgba(148, 163, 184, 0.15);
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    padding: 1.25rem 0.25rem 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .subsection-header:first-child {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }

  .subsection-header + .setting-subsection {
    margin-top: 0;
  }

  .subsection-header h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .subsection-header p {
    margin: 0.25rem 0 0;
    color: #94a3b8;
    font-size: 0.85rem;
  }

  .settings-section {
    scroll-margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .settings-section + .settings-section {
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    margin-top: 1.5rem;
    padding-top: 1.5rem;
  }
</style>
