<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import type { BridgeSerialInfo, BridgeStatus } from '../types';
  import GalleryItemCard from '../components/GalleryItemCard.svelte';
  import GalleryPreviewModal from '../components/GalleryPreviewModal.svelte';
  import PortToolbar from '../components/PortToolbar.svelte';

  const GALLERY_LIST_URL = './api/gallery/list';
  const REQUEST_TIMEOUT_MS = 8000;

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
    parameters?: GalleryParameterDefinition[];
    content_summary: ContentSummary;
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

  interface GalleryParameterDefinition {
    name: string;
    type: 'integer' | 'string' | 'integer[]' | 'object[]';
    default?: unknown;
    min?: number;
    max?: number;
    label?: string;
    label_en?: string;
    description?: string;
    description_en?: string;
    schema?: Record<string, unknown>;
  }

  interface Vendor {
    id: string;
    name: string;
    requirements?: {
      serial?: Record<string, unknown>;
      packet_defaults?: Record<string, unknown>;
    };
    items: GalleryItem[];
  }

  interface GalleryData {
    generated_at: string;
    vendors: Vendor[];
  }

  let {
    portMetadata,
    portStatuses = [],
    selectedPortId,
    onPortChange,
  }: {
    portMetadata: Array<BridgeSerialInfo & { configFile: string }>;
    portStatuses?: { portId: string; status: BridgeStatus | 'unknown'; message?: string }[];
    selectedPortId: string | null;
    onPortChange?: (portId: string) => void;
  } = $props();

  let galleryData: GalleryData | null = $state(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let searchQuery = $state('');
  let selectedVendor = $state<string | null>(null);
  let filterType = $state<'all' | 'entities' | 'automation' | 'scripts'>('all');

  let selectedItem = $state<
    (GalleryItem & { vendorId: string; vendorRequirements?: Vendor['requirements'] }) | null
  >(null);
  let showPreviewModal = $state(false);

  // Discovery results
  let discoveryResults = $state<Record<string, DiscoveryResult>>({});
  let discoveryLoading = $state(false);
  let compatibilityByVendor = $state<Record<string, boolean>>({});
  let compatibilityRequestId = $state(0);
  let compatibilityCache = $state<Map<string, Record<string, boolean>>>(new Map());
  let compatibilityTimeoutId = $state<ReturnType<typeof setTimeout> | null>(null);
  let galleryAbortController = $state<AbortController | null>(null);
  let discoveryAbortController = $state<AbortController | null>(null);
  let compatibilityAbortController = $state<AbortController | null>(null);

  const portIds = $derived.by<string[]>(() =>
    portMetadata.map((port: BridgeSerialInfo & { configFile: string }) => port.portId),
  );
  const activePortId = $derived.by<string | null>(() =>
    selectedPortId && portIds.includes(selectedPortId) ? selectedPortId : (portIds[0] ?? null),
  );

  async function loadDiscovery(portId: string | null) {
    if (!portId) {
      discoveryResults = {};
      return;
    }
    discoveryLoading = true;
    if (discoveryAbortController) {
      discoveryAbortController.abort();
    }
    const controller = new AbortController();
    discoveryAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`./api/gallery/discovery?portId=${encodeURIComponent(portId)}`, {
        signal: controller.signal,
      });
      if (response.ok) {
        const data = await response.json();
        if (data.available && data.results) {
          discoveryResults = data.results;
        }
      }
    } catch {
      // Ignore discovery errors - it's optional
    } finally {
      clearTimeout(timeoutId);
      if (discoveryAbortController === controller) {
        discoveryAbortController = null;
      }
      discoveryLoading = false;
    }
  }

  async function loadGallery() {
    loading = true;
    error = null;
    if (galleryAbortController) {
      galleryAbortController.abort();
    }
    const controller = new AbortController();
    galleryAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(GALLERY_LIST_URL, { signal: controller.signal });
      if (!response.ok) throw new Error('Failed to fetch gallery');
      galleryData = await response.json();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        error = 'Request timeout';
      } else {
        error = e instanceof Error ? e.message : 'Unknown error';
      }
    } finally {
      clearTimeout(timeoutId);
      if (galleryAbortController === controller) {
        galleryAbortController = null;
      }
      loading = false;
    }
  }

  onMount(() => {
    loadGallery();
  });

  async function loadCompatibility(portId: string, vendors: Vendor[], cacheKey: string) {
    const compatibleKey = cacheKey;
    const cached = compatibilityCache.get(compatibleKey);
    if (cached) {
      compatibilityByVendor = cached;
      return;
    }

    if (compatibilityAbortController) {
      compatibilityAbortController.abort();
    }
    const controller = new AbortController();
    compatibilityAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const requestId = compatibilityRequestId + 1;
    compatibilityRequestId = requestId;
    try {
      const response = await fetch('./api/gallery/compatibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          portId,
          vendors: vendors.map((vendor) => ({
            id: vendor.id,
            requirements: vendor.requirements,
          })),
        }),
      });
      if (!response.ok) throw new Error('Failed to fetch compatibility');
      const data = await response.json();
      if (compatibilityRequestId !== requestId) return;
      compatibilityByVendor = data.compatibilityByVendorId ?? {};
      compatibilityCache = new Map(compatibilityCache).set(
        compatibleKey,
        data.compatibilityByVendorId ?? {},
      );
    } catch {
      if (compatibilityRequestId !== requestId) return;
      compatibilityByVendor = {};
    } finally {
      clearTimeout(timeoutId);
      if (compatibilityAbortController === controller) {
        compatibilityAbortController = null;
      }
    }
  }

  $effect(() => {
    if (!activePortId) {
      discoveryResults = {};
      return;
    }

    loadDiscovery(activePortId);
  });

  $effect(() => {
    if (!galleryData || !activePortId) {
      compatibilityByVendor = {};
      return;
    }

    const vendors = galleryData.vendors;
    const vendorKey = vendors.map((vendor) => vendor.id).join('|');
    const cacheKey = `${activePortId}:${galleryData.generated_at ?? 'unknown'}:${vendorKey}`;

    if (compatibilityTimeoutId) {
      clearTimeout(compatibilityTimeoutId);
      compatibilityTimeoutId = null;
    }

    const timeoutId = setTimeout(() => {
      loadCompatibility(activePortId, vendors, cacheKey);
    }, 300);
    compatibilityTimeoutId = timeoutId;

    return () => {
      clearTimeout(timeoutId);
    };
  });

  function resolveCompatibility(vendorId: string) {
    if (!activePortId) return false;
    const vendorCompatibility = compatibilityByVendor[vendorId];
    return vendorCompatibility ?? true;
  }

  const filteredItems = $derived(() => {
    if (!galleryData) return [];

    let items: (GalleryItem & {
      vendorId: string;
      vendorName: string;
      vendorRequirements?: Vendor['requirements'];
    })[] = [];
    for (const vendor of galleryData.vendors) {
      if (selectedVendor && vendor.id !== selectedVendor) continue;
      for (const item of vendor.items) {
        items.push({
          ...item,
          vendorId: vendor.id,
          vendorName: vendor.name,
          vendorRequirements: vendor.requirements,
        });
      }
    }

    // Filter by type
    if (filterType === 'entities') {
      items = items.filter((item) => Object.keys(item.content_summary.entities).length > 0);
    } else if (filterType === 'automation') {
      items = items.filter((item) => item.content_summary.automations > 0);
    } else if (filterType === 'scripts') {
      items = items.filter((item) => (item.content_summary.scripts ?? 0) > 0);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.name_en?.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.description_en?.toLowerCase().includes(query) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    const decoratedItems = items.map((item) => ({
      ...item,
      isCompatible: resolveCompatibility(item.vendorId),
    }));

    // Sort: compatible items first, then items with discovery, then items with parameters
    decoratedItems.sort((a, b) => {
      const aCompatible = a.isCompatible ? 1 : 0;
      const bCompatible = b.isCompatible ? 1 : 0;
      if (bCompatible !== aCompatible) return bCompatible - aCompatible;

      // Discovery match takes priority
      const aDiscovered = discoveryResults[a.file]?.matched ? 2 : 0;
      const bDiscovered = discoveryResults[b.file]?.matched ? 2 : 0;
      if (bDiscovered !== aDiscovered) return bDiscovered - aDiscovered;

      // Then items with parameters
      const aHasParams = (a.parameters?.length ?? 0) > 0 ? 1 : 0;
      const bHasParams = (b.parameters?.length ?? 0) > 0 ? 1 : 0;
      return bHasParams - aHasParams;
    });

    return decoratedItems;
  });

  function openPreview(
    item: GalleryItem & { vendorId: string; vendorRequirements?: Vendor['requirements'] },
  ) {
    selectedItem = item;
    showPreviewModal = true;
  }

  function closePreview() {
    showPreviewModal = false;
    selectedItem = null;
  }
</script>

<div class="gallery-container">
  <header class="gallery-header">
    <h1>{$t('gallery.title')}</h1>
    <p class="subtitle">{$t('gallery.subtitle')}</p>
  </header>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>{$t('gallery.loading')}</p>
    </div>
  {:else if error}
    <div class="error-state">
      <p>⚠️ {$t('gallery.load_error')}</p>
      <button class="retry-btn" onclick={() => loadGallery()}>
        {$t('gallery.retry')}
      </button>
    </div>
  {:else if galleryData}
    <PortToolbar {portIds} {activePortId} {portStatuses} {onPortChange} />

    <div class="filters">
      <div class="search-box">
        <input
          type="text"
          placeholder={$t('gallery.search_placeholder')}
          bind:value={searchQuery}
        />
      </div>

      <div class="filter-group">
        <label for="vendor-select">{$t('gallery.vendor')}</label>
        <select id="vendor-select" bind:value={selectedVendor}>
          <option value={null}>{$t('gallery.filter_all')}</option>
          {#each galleryData.vendors as vendor (vendor.id)}
            <option value={vendor.id}>{vendor.name}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <span class="filter-label">{$t('gallery.type')}</span>
        <div class="filter-buttons">
          <button class:active={filterType === 'all'} onclick={() => (filterType = 'all')}>
            {$t('gallery.filter_all')}
          </button>
          <button
            class:active={filterType === 'entities'}
            onclick={() => (filterType = 'entities')}
          >
            {$t('gallery.filter_entities')}
          </button>
          <button
            class:active={filterType === 'automation'}
            onclick={() => (filterType = 'automation')}
          >
            {$t('gallery.filter_automation')}
          </button>
          <button class:active={filterType === 'scripts'} onclick={() => (filterType = 'scripts')}>
            {$t('gallery.filter_scripts')}
          </button>
        </div>
      </div>
    </div>

    <div class="items-grid">
      {#each filteredItems() as item (item.file)}
        <GalleryItemCard
          {item}
          isCompatible={item.isCompatible}
          discoveryResult={discoveryResults[item.file]}
          onViewDetails={() => item.isCompatible && openPreview(item)}
        />
      {:else}
        <div class="no-items">
          <p>{$t('gallery.no_items')}</p>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showPreviewModal && selectedItem}
  <GalleryPreviewModal
    item={selectedItem}
    portId={activePortId}
    vendorRequirements={selectedItem.vendorRequirements}
    discoveryResult={discoveryResults[selectedItem.file]}
    onClose={closePreview}
  />
{/if}

<style>
  .gallery-container {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .gallery-header {
    margin-bottom: 1.5rem;
  }

  .gallery-header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0 0 0.5rem 0;
  }

  .subtitle {
    color: #94a3b8;
    font-size: 0.9rem;
    margin: 0;
  }

  .loading-state,
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    gap: 1rem;
    color: #94a3b8;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(59, 130, 246, 0.2);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .retry-btn {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .retry-btn:hover {
    background: #2563eb;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: rgba(30, 41, 59, 0.5);
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.1);
  }

  .search-box {
    flex: 1;
    min-width: 200px;
  }

  .search-box input {
    width: calc(100% - 2rem);
    margin-top: 1.3rem;
    padding: 0.6rem 1rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    color: #f1f5f9;
    font-size: 0.9rem;
  }

  .search-box input::placeholder {
    color: #64748b;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .filter-group label,
  .filter-group .filter-label {
    font-size: 0.75rem;
    color: #94a3b8;
    text-transform: uppercase;
  }

  .filter-group select {
    padding: 0.5rem 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    color: #f1f5f9;
    font-size: 0.9rem;
  }

  .filter-buttons {
    display: flex;
    gap: 0.25rem;
  }

  .filter-buttons button {
    padding: 0.4rem 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 4px;
    color: #94a3b8;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .filter-buttons button:hover {
    background: rgba(59, 130, 246, 0.1);
    color: #f1f5f9;
  }

  .filter-buttons button.active {
    background: rgba(59, 130, 246, 0.2);
    border-color: #3b82f6;
    color: #3b82f6;
  }

  .items-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .no-items {
    grid-column: 1 / -1;
    text-align: center;
    padding: 3rem;
    color: #64748b;
  }

  @media (max-width: 768px) {
    .gallery-container {
      padding: 1rem;
    }

    .filters {
      flex-direction: column;
    }

    .items-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
