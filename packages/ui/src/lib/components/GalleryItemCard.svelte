<script lang="ts">
  import { t, locale } from 'svelte-i18n';

  interface ContentSummary {
    entities: Record<string, number>;
    automations: number;
    scripts?: number;
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
    parameters?: { name: string }[];
    content_summary: ContentSummary;
    vendorId: string;
    vendorName: string;
    requirements?: {
      serial?: Record<string, unknown>;
      packet_defaults?: Record<string, unknown>;
    };
  }

  interface DiscoveryResult {
    matched: boolean;
    matchedPacketCount: number;
    parameterValues: Record<string, unknown>;
    ui?: {
      label?: string;
      label_en?: string;
      badge?: string;
      summary?: string;
      summary_en?: string;
    };
  }

  let {
    item,
    discoveryResult,
    isCompatible = true,
    downloadCount = 0,
    onViewDetails,
  }: {
    item: GalleryItem;
    discoveryResult?: DiscoveryResult;
    isCompatible?: boolean;
    downloadCount?: number;
    onViewDetails: () => void;
  } = $props();

  const displayName = $derived(
    $locale?.startsWith('en') && item.name_en ? item.name_en : item.name,
  );

  const displayDescription = $derived(
    $locale?.startsWith('en') && item.description_en ? item.description_en : item.description,
  );

  const entityTypes = $derived(Object.entries(item.content_summary.entities));
  const hasEntities = $derived(entityTypes.length > 0);
  const hasAutomation = $derived(item.content_summary.automations > 0);
  const scriptCount = $derived(item.content_summary.scripts ?? 0);
  const hasScripts = $derived(scriptCount > 0);
  const hasParameters = $derived((item.parameters?.length ?? 0) > 0);
  const isDiscovered = $derived(discoveryResult?.matched ?? false);

  // Get discovery badge text
  const discoveryBadgeText = $derived(() => {
    if (!discoveryResult?.matched) return '';
    const values = Object.values(discoveryResult.parameterValues).filter(
      (v) => typeof v === 'number',
    );
    if (values.length > 0) {
      const count = Math.max(...(values as number[]));
      const label = $locale?.startsWith('en')
        ? discoveryResult.ui?.label_en || discoveryResult.ui?.label || 'devices'
        : discoveryResult.ui?.label || 'devices';
      return `${count} ${label}`;
    }
    return $locale?.startsWith('en') ? 'Discovered' : '발견됨';
  });
</script>

<div class="card" class:disabled={!isCompatible} aria-disabled={!isCompatible}>
  <div class="card-header">
    <div class="title-row">
      <h3 class="card-title">{displayName}</h3>
      {#if isDiscovered}
        <span class="badge discovery" title="패킷이 감지되었습니다">
          🔍 {discoveryBadgeText()}
        </span>
      {/if}
      {#if !isCompatible}
        <span class="badge incompatible" title={$t('gallery.incompatible_port')}>
          ⚠️ {$t('gallery.incompatible_port')}
        </span>
      {/if}
      {#if hasParameters}
        <span class="badge parameter" title={$t('gallery.has_parameters')}>
          ⚙️ {$t('gallery.parameters')}
        </span>
      {/if}
    </div>
    <div class="card-badges">
      <span class="version">v{item.version}</span>
      {#if downloadCount > 0}
        <span class="badge downloads" title={$t('gallery.download_count')}>
          ⬇️ {downloadCount}
        </span>
      {/if}
    </div>
  </div>

  <p class="description">{displayDescription}</p>

  <div class="meta">
    <div class="meta-row">
      <span class="label">{$t('gallery.vendor')}:</span>
      <span class="value">{item.vendorName}</span>
    </div>
    <div class="meta-row">
      <span class="label">{$t('gallery.author')}:</span>
      <span class="value">{item.author}</span>
    </div>
  </div>

  <div class="content-summary">
    {#if hasEntities}
      <div class="summary-section">
        <span class="summary-label">{$t('gallery.entities')}:</span>
        <div class="summary-items">
          {#each entityTypes as [type, count], index (`${type}-${index}`)}
            <span class="badge entity">{type}: {count}</span>
          {/each}
        </div>
      </div>
    {/if}
    {#if hasAutomation}
      <div class="summary-section">
        <span class="summary-label">{$t('gallery.automations')}:</span>
        <span class="badge automation">{item.content_summary.automations}</span>
      </div>
    {/if}
    {#if hasScripts}
      <div class="summary-section">
        <span class="summary-label">{$t('gallery.scripts')}:</span>
        <span class="badge script">{scriptCount}</span>
      </div>
    {/if}
  </div>

  {#if item.tags.length > 0}
    <div class="tags">
      {#each item.tags as tag, index (`${tag}-${index}`)}
        <span class="tag">{tag}</span>
      {/each}
    </div>
  {/if}

  <button class="view-btn" onclick={onViewDetails} disabled={!isCompatible}>
    {$t('gallery.view_details')}
  </button>
</div>

<style>
  .card {
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 10px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    transition: all 0.2s;
    min-width: 0;
  }

  .card:hover {
    border-color: rgba(59, 130, 246, 0.3);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  }

  .card.disabled {
    opacity: 0.55;
    border-color: rgba(148, 163, 184, 0.05);
  }

  .card.disabled:hover {
    border-color: rgba(148, 163, 184, 0.05);
    box-shadow: none;
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .card-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .version {
    font-size: 0.7rem;
    color: #64748b;
    background: rgba(100, 116, 139, 0.2);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    white-space: nowrap;
  }

  .card-badges {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .badge.downloads {
    background: rgba(99, 102, 241, 0.15);
    color: #818cf8;
    border: 1px solid rgba(99, 102, 241, 0.3);
  }

  .description {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0;
    line-height: 1.5;
    overflow-wrap: anywhere;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
  }

  .meta-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .label {
    color: #64748b;
  }

  .value {
    color: #94a3b8;
    overflow-wrap: anywhere;
  }

  .content-summary {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .summary-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .summary-label {
    font-size: 0.75rem;
    color: #64748b;
  }

  .summary-items {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .badge {
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
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

  .badge.script {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .badge.parameter {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.3);
  }

  .badge.discovery {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .badge.incompatible {
    background: rgba(248, 113, 113, 0.15);
    color: #f87171;
    border: 1px solid rgba(248, 113, 113, 0.3);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .tag {
    font-size: 0.7rem;
    color: #64748b;
    background: rgba(100, 116, 139, 0.15);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .view-btn {
    margin-top: auto;
    padding: 0.6rem 1rem;
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 6px;
    color: #60a5fa;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .view-btn:hover {
    background: rgba(59, 130, 246, 0.25);
    border-color: #3b82f6;
  }

  .view-btn:disabled {
    cursor: not-allowed;
    background: rgba(15, 23, 42, 0.4);
    border-color: rgba(148, 163, 184, 0.2);
    color: #64748b;
  }
</style>
