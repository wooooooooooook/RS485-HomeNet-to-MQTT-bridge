<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { onMount, untrack } from 'svelte';

  interface ContentSummary {
    entities: Record<string, number>;
    automations: number;
  }

  interface GalleryItem {
    file: string;
    name: string;
    name_en?: string;
    description: string;
    description_en?: string;
    version: string;
    author: string;
    tags: string[];
    content_summary: ContentSummary;
    vendorId: string;
  }

  const GITHUB_RAW_BASE =
    'https://raw.githubusercontent.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/main/gallery';

  let {
    item,
    ports,
    onClose,
  }: {
    item: GalleryItem;
    ports: { portId: string; path: string }[];
    onClose: () => void;
  } = $props();

  let yamlContent = $state('');
  let loadingYaml = $state(true);
  let yamlError = $state<string | null>(null);

  let selectedPortId = $state(untrack(() => ports[0]?.portId ?? ''));
  let applying = $state(false);
  let applyError = $state<string | null>(null);
  let applySuccess = $state(false);

  const displayName = $derived(
    $locale?.startsWith('en') && item.name_en ? item.name_en : item.name,
  );

  const displayDescription = $derived(
    $locale?.startsWith('en') && item.description_en ? item.description_en : item.description,
  );

  async function loadYamlContent() {
    loadingYaml = true;
    yamlError = null;
    try {
      const url = `${GITHUB_RAW_BASE}/${item.file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch YAML');
      yamlContent = await response.text();
    } catch (e) {
      yamlError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loadingYaml = false;
    }
  }

  onMount(() => {
    loadYamlContent();
  });

  async function applySnippet() {
    if (!selectedPortId) return;

    applying = true;
    applyError = null;
    applySuccess = false;

    try {
      const response = await fetch('/api/gallery/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portId: selectedPortId,
          yamlContent,
          fileName: item.file,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to apply snippet');
      }

      applySuccess = true;
    } catch (e) {
      applyError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      applying = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="modal-backdrop">
  <button class="backdrop-close" onclick={onClose} aria-label={$t('common.close')}></button>
  <div class="modal" role="dialog" aria-modal="true">
    <header class="modal-header">
      <div class="header-content">
        <h2>{displayName}</h2>
        <p class="description">{displayDescription}</p>
      </div>
      <button class="close-btn" onclick={onClose} aria-label={$t('common.close')}> × </button>
    </header>

    <div class="modal-body">
      <div class="info-section">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">{$t('gallery.vendor')}</span>
            <span class="info-value">{item.vendorId}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{$t('gallery.version')}</span>
            <span class="info-value">v{item.version}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{$t('gallery.author')}</span>
            <span class="info-value">{item.author}</span>
          </div>
        </div>

        <div class="contents-summary">
          <h4>{$t('gallery.preview.contents')}</h4>
          <div class="summary-badges">
            {#each Object.entries(item.content_summary.entities) as [type, count]}
              <span class="badge entity"
                >{$t('gallery.preview.entity_count', {
                  values: { type, count },
                })}</span
              >
            {/each}
            {#if item.content_summary.automations > 0}
              <span class="badge automation"
                >{$t('gallery.preview.automation_count', {
                  values: { count: item.content_summary.automations },
                })}</span
              >
            {/if}
          </div>
        </div>

        {#if item.tags.length > 0}
          <div class="tags-section">
            <span class="info-label">{$t('gallery.tags')}</span>
            <div class="tags">
              {#each item.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="yaml-section">
        <h4>{$t('gallery.preview.yaml_content')}</h4>
        {#if loadingYaml}
          <div class="yaml-loading">
            <div class="spinner"></div>
          </div>
        {:else if yamlError}
          <div class="yaml-error">⚠️ {yamlError}</div>
        {:else}
          <pre class="yaml-content"><code>{yamlContent}</code></pre>
        {/if}
      </div>
    </div>

    <footer class="modal-footer">
      {#if applySuccess}
        <div class="success-message">✓ {$t('gallery.preview.success')}</div>
      {:else if applyError}
        <div class="error-message">⚠️ {applyError}</div>
      {/if}

      <div class="footer-controls">
        <div class="port-select">
          <label for="port-select">{$t('gallery.preview.select_port')}</label>
          <select id="port-select" bind:value={selectedPortId}>
            {#each ports as port}
              <option value={port.portId}>{port.portId} ({port.path})</option>
            {/each}
          </select>
        </div>

        <div class="action-buttons">
          <button class="cancel-btn" onclick={onClose}>
            {$t('gallery.preview.cancel')}
          </button>
          <button
            class="apply-btn"
            onclick={applySnippet}
            disabled={applying || !selectedPortId || loadingYaml}
          >
            {#if applying}
              {$t('gallery.preview.applying')}
            {:else}
              {$t('gallery.preview.apply')}
            {/if}
          </button>
        </div>
      </div>
    </footer>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    backdrop-filter: blur(4px);
  }

  .backdrop-close {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: none;
    border: none;
    cursor: default;
  }

  .modal {
    background: #1e293b;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    max-width: 800px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .header-content h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0 0 0.25rem 0;
  }

  .header-content .description {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: #f1f5f9;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .info-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .info-label {
    font-size: 0.75rem;
    color: #64748b;
    text-transform: uppercase;
  }

  .info-value {
    font-size: 0.9rem;
    color: #f1f5f9;
  }

  .contents-summary h4 {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0 0 0.5rem 0;
  }

  .summary-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .badge {
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
  }

  .badge.entity {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .badge.automation {
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  .tags-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .tag {
    font-size: 0.7rem;
    color: #94a3b8;
    background: rgba(100, 116, 139, 0.2);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }

  .yaml-section {
    flex: 1;
    min-height: 0;
  }

  .yaml-section h4 {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0 0 0.75rem 0;
  }

  .yaml-loading {
    display: flex;
    justify-content: center;
    padding: 2rem;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(59, 130, 246, 0.2);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .yaml-error {
    color: #f87171;
    padding: 1rem;
    text-align: center;
  }

  .yaml-content {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 8px;
    padding: 1rem;
    overflow: auto;
    max-height: 300px;
    margin: 0;
  }

  .yaml-content code {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.8rem;
    color: #e2e8f0;
    white-space: pre;
  }

  .modal-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .success-message {
    color: #4ade80;
    font-size: 0.9rem;
    text-align: center;
  }

  .error-message {
    color: #f87171;
    font-size: 0.9rem;
    text-align: center;
  }

  .footer-controls {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }

  .port-select {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .port-select label {
    font-size: 0.75rem;
    color: #64748b;
  }

  .port-select select {
    padding: 0.5rem 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    color: #f1f5f9;
    font-size: 0.85rem;
    min-width: 200px;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .cancel-btn,
  .apply-btn {
    padding: 0.6rem 1.25rem;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .cancel-btn {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
  }

  .cancel-btn:hover {
    border-color: rgba(148, 163, 184, 0.4);
    color: #f1f5f9;
  }

  .apply-btn {
    background: #3b82f6;
    border: none;
    color: white;
  }

  .apply-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .apply-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .modal {
      max-height: 100vh;
      border-radius: 0;
    }

    .info-grid {
      grid-template-columns: 1fr 1fr;
    }

    .footer-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .port-select select {
      width: 100%;
    }

    .action-buttons {
      justify-content: flex-end;
    }
  }
</style>
