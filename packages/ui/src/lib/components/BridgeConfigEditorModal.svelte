<script lang="ts">
  import { t } from 'svelte-i18n';
  import Button from './Button.svelte';
  import MonacoYamlEditor from './MonacoYamlEditor.svelte';
  import Modal from './Modal.svelte';

  let {
    filename,
    onclose,
    onsave,
    onrestart,
    mode = 'monaco',
  }: {
    filename: string;
    onclose: () => void;
    onsave?: () => void;
    onrestart?: () => void;
    mode?: 'monaco' | 'textarea';
  } = $props();

  let content = $state('');
  let isLoading = $state(true);
  let isSaving = $state(false);
  let isRestarting = $state(false);
  let error = $state<string | null>(null);
  let saveSuccess = $state(false);

  const fetchContent = async () => {
    isLoading = true;
    error = null;
    try {
      const res = await fetch(`./api/config/files/${encodeURIComponent(filename)}?_=${Date.now()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      content = data.content || '';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load config';
    } finally {
      isLoading = false;
    }
  };

  const handleSave = async (shouldRestart = false) => {
    if (isSaving || isRestarting) return;
    isSaving = true;
    error = null;
    saveSuccess = false;

    try {
      const res = await fetch(`./api/config/files/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, scheduleRestart: shouldRestart }),
      });

      const data = await res.json();

      if (!res.ok) {
        let errorMsg = data.error || `HTTP ${res.status}`;
        if (data.details) {
          errorMsg += `: ${data.details}`;
        }
        throw new Error(errorMsg);
      }

      saveSuccess = true;
      onsave?.();

      if (shouldRestart && onrestart) {
        isRestarting = true;
        await onrestart();
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
      isRestarting = false;
    } finally {
      isSaving = false;
    }
  };

  $effect(() => {
    fetchContent();
  });

  const handleKeydown = (event: KeyboardEvent) => {
    // Escape handled by Modal
    // Save with Ctrl/Cmd + S (Default: Save only)
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      handleSave(false);
    }
  };

  const hintId = `editor-hint-${Math.random().toString(36).slice(2, 9)}`;
</script>

<svelte:window on:keydown={handleKeydown} />

<Modal open={true} width="900px" {onclose} oncancel={onclose}>
  <div class="modal-content-wrapper">
    <div class="modal-header">
      <h2>{$t('settings.bridge_config.edit_title')}</h2>
      <span class="filename">{filename}</span>
      <button class="close-btn" onclick={onclose} aria-label={$t('common.close')}>×</button>
    </div>

    <div class="modal-body">
      {#if isLoading}
        <div class="loading">{$t('entity_detail.config.loading')}</div>
      {:else if error}
        <div class="error-banner">
          <span>{error}</span>
          {#if !saveSuccess}
            <Button variant="secondary" onclick={fetchContent}>
              {$t('gallery.retry')}
            </Button>
          {/if}
        </div>
      {/if}

      {#if saveSuccess}
        <div class="success-banner">
          {$t('settings.bridge_config.edit_success')}
        </div>
      {/if}

      <MonacoYamlEditor
        class="yaml-editor"
        value={content}
        onChange={(nextValue) => (content = nextValue)}
        readOnly={isLoading}
        ariaLabel={$t('settings.bridge_config.edit_title')}
        ariaDescribedBy={hintId}
        placeholder="homenet_bridge:\n  serial:\n    ..."
        schemaUri="./api/schema/homenet-bridge"
        {mode}
      />

      <div id={hintId} class="editor-hint">
        {$t('settings.bridge_config.edit_hint')}
      </div>
    </div>

    <div class="modal-footer">
      <Button variant="secondary" onclick={onclose} disabled={isSaving || isRestarting}>
        {$t('common.cancel')}
      </Button>
      <Button
        onclick={() => handleSave(false)}
        isLoading={isSaving}
        disabled={isLoading || isSaving || isRestarting}
      >
        {$t('settings.bridge_config.save_only')}
      </Button>
      <Button
        variant="danger"
        onclick={() => handleSave(true)}
        isLoading={isRestarting}
        disabled={isLoading || isSaving || isRestarting}
      >
        {isRestarting
          ? $t('settings.bridge_config.restarting')
          : $t('settings.bridge_config.save_and_restart')}
      </Button>
    </div>
  </div>
</Modal>

<style>
  .modal-content-wrapper {
    position: relative;
    width: 100%;
    height: 85dvh;
    background: linear-gradient(145deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.95));
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .filename {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.85rem;
    color: #60a5fa;
    background: rgba(59, 130, 246, 0.1);
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
  }

  .close-btn {
    margin-left: auto;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid #475569;
    color: #e2e8f0;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(30, 41, 59, 0.9);
    border-color: #94a3b8;
  }

  .modal-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem 1.5rem;
    /* overflow: hidden removed to allow monaco widgets to be visible */
    gap: 0.75rem;
  }

  .loading {
    color: #94a3b8;
    font-size: 0.95rem;
    padding: 2rem;
    text-align: center;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #fca5a5;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .error-banner span {
    flex: 1;
    font-size: 0.9rem;
  }

  .success-banner {
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #86efac;
    font-size: 0.9rem;
  }

  :global(.yaml-editor) {
    position: relative;
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    color: #e2e8f0;
    font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    padding: 1rem;
    tab-size: 2;
    /* overflow: hidden removed to allow monaco widgets to be visible */
  }

  :global(.yaml-editor:focus-within) {
    border-color: rgba(59, 130, 246, 0.5);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .editor-hint {
    color: #64748b;
    font-size: 0.8rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgba(148, 163, 184, 0.15);
  }

  @media (max-width: 640px) {
    .modal-content-wrapper {
      border-radius: 0;
    }

    .filename {
      display: none;
    }

    .modal-header h2 {
      font-size: 1.1rem;
    }

    :global(.yaml-editor) {
      font-size: 0.8rem;
    }
  }
</style>
