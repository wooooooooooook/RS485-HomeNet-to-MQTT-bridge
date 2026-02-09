<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import type {
    BridgeErrorPayload,
    BridgeSerialInfo,
    BridgeStatus,
    GalleryData,
    GalleryDiscoveryResult,
    GalleryItemForPreview,
    GalleryItemWithVendor,
    GalleryVendor,
  } from '../types';
  import GalleryItemCard from '../components/GalleryItemCard.svelte';
  import GalleryPreviewModal from '../components/GalleryPreviewModal.svelte';
  import Dialog from '../components/Dialog.svelte';

  const GALLERY_LIST_URL = './api/gallery/list';
  const GALLERY_STATS_URL = './api/gallery/stats';
  const REQUEST_TIMEOUT_MS = 8000;

  let {
    portMetadata,
    portStatuses = [],
    activePortId,
  }: {
    portMetadata: Array<BridgeSerialInfo & { configFile: string }>;
    portStatuses?: {
      portId: string;
      status: BridgeStatus | 'unknown';
      message?: string;
      errorInfo?: BridgeErrorPayload | null;
    }[];
    activePortId: string | null;
  } = $props();

  let galleryData: GalleryData | null = $state(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let searchQuery = $state('');
  let selectedVendor = $state<string | null>(null);
  let filterType = $state<'all' | 'entities' | 'automation' | 'scripts'>('all');

  let selectedItem = $state<GalleryItemForPreview | null>(null);
  let showPreviewModal = $state(false);

  let incompatibleWarningOpen = $state(false);
  let pendingItem = $state<GalleryItemForPreview | null>(null);

  // Discovery results
  let discoveryResults = $state<Record<string, GalleryDiscoveryResult>>({});
  let discoveryLoading = $state(false);
  let compatibilityByVendor = $state<Record<string, boolean>>({});
  let compatibilityRequestId = $state(0);
  let compatibilityCache = $state<Map<string, Record<string, boolean>>>(new Map());
  let compatibilityTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let discoveryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let discoveryPortId: string | null = null;
  let discoveryRequestInFlight = false;
  let galleryAbortController = $state<AbortController | null>(null);
  let discoveryAbortController = $state<AbortController | null>(null);
  let compatibilityAbortController = $state<AbortController | null>(null);

  // Download stats
  let downloadStats = $state<Record<string, number>>({});

  const portIds = $derived.by<string[]>(() =>
    portMetadata.map((port: BridgeSerialInfo & { configFile: string }) => port.portId),
  );

  async function loadDiscovery(portId: string | null) {
    if (!portId) {
      discoveryResults = {};
      discoveryPortId = null;
      discoveryRequestInFlight = false;
      return;
    }
    if (discoveryRequestInFlight && discoveryPortId === portId) return;
    discoveryLoading = true;
    discoveryPortId = portId;
    discoveryRequestInFlight = true;
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
      discoveryRequestInFlight = false;
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

  async function loadStats() {
    try {
      const response = await fetch(GALLERY_STATS_URL);
      if (response.ok) {
        const data = await response.json();
        downloadStats = data.stats ?? {};
      }
    } catch {
      // Ignore stats errors - it's optional
    }
  }

  onMount(() => {
    loadGallery();
    loadStats();
  });

  async function loadCompatibility(portId: string, vendors: GalleryVendor[], cacheKey: string) {
    const compatibleKey = cacheKey;
    const cached = compatibilityCache.get(compatibleKey);
    if (cached) {
      compatibilityByVendor = cached;
      return;
    }

    const vendorsWithRequirements = vendors.filter((vendor) => vendor.requirements);
    if (vendorsWithRequirements.length === 0) {
      compatibilityByVendor = {};
      compatibilityCache = new Map(compatibilityCache).set(compatibleKey, {});
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
          vendors: vendorsWithRequirements.map((vendor) => ({
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
      discoveryPortId = null;
      discoveryRequestInFlight = false;
      return;
    }

    if (activePortId === discoveryPortId) return;

    if (discoveryTimeoutId) {
      clearTimeout(discoveryTimeoutId);
      discoveryTimeoutId = null;
    }

    const timeoutId = setTimeout(() => {
      loadDiscovery(activePortId);
    }, 300);
    discoveryTimeoutId = timeoutId;

    return () => {
      clearTimeout(timeoutId);
    };
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
    if (!galleryData) return { discovered: [], others: [] };

    let items: GalleryItemWithVendor[] = [];
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

    // Split into discovered and others
    const discovered: typeof decoratedItems = [];
    const others: typeof decoratedItems = [];

    for (const item of decoratedItems) {
      if (discoveryResults[item.file]?.matched) {
        discovered.push(item);
      } else {
        others.push(item);
      }
    }

    // Sort function
    const sortFn = (a: (typeof decoratedItems)[0], b: (typeof decoratedItems)[0]) => {
      const aCompatible = a.isCompatible ? 1 : 0;
      const bCompatible = b.isCompatible ? 1 : 0;
      if (bCompatible !== aCompatible) return bCompatible - aCompatible;

      // Then items with parameters
      const aHasParams = (a.parameters?.length ?? 0) > 0 ? 1 : 0;
      const bHasParams = (b.parameters?.length ?? 0) > 0 ? 1 : 0;
      return bHasParams - aHasParams;
    };

    discovered.sort(sortFn);
    others.sort(sortFn);

    return { discovered, others };
  });

  function openPreview(item: GalleryItemForPreview) {
    selectedItem = item;
    showPreviewModal = true;
  }

  function closePreview() {
    showPreviewModal = false;
    selectedItem = null;
  }

  function handleItemClick(item: GalleryItemForPreview) {
    if (item.isCompatible) {
      openPreview(item);
    } else {
      pendingItem = item;
      incompatibleWarningOpen = true;
    }
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

    <div class="items-grid-container">
      {#if filteredItems().discovered.length > 0}
        <section class="items-section discovered-section">
          <div class="section-header">
            <h2>✨ {$t('gallery.discovered_items')}</h2>
            <span class="section-badge">{filteredItems().discovered.length}</span>
          </div>
          <div class="items-grid">
            {#each filteredItems().discovered as item (item.file)}
              <GalleryItemCard
                {item}
                isCompatible={item.isCompatible}
                discoveryResult={discoveryResults[item.file]}
                downloadCount={downloadStats[item.file] ?? 0}
                onViewDetails={() => handleItemClick(item)}
              />
            {/each}
          </div>
        </section>
      {/if}

      {#if filteredItems().others.length > 0}
        <section class="items-section">
          {#if filteredItems().discovered.length > 0}
            <div class="section-header">
              <h2>{$t('gallery.other_items')}</h2>
              <span class="section-badge">{filteredItems().others.length}</span>
            </div>
          {/if}
          <div class="items-grid">
            {#each filteredItems().others as item (item.file)}
              <GalleryItemCard
                {item}
                isCompatible={item.isCompatible}
                discoveryResult={discoveryResults[item.file]}
                downloadCount={downloadStats[item.file] ?? 0}
                onViewDetails={() => handleItemClick(item)}
              />
            {/each}
          </div>
        </section>
      {/if}

      {#if filteredItems().discovered.length === 0 && filteredItems().others.length === 0}
        <div class="no-items">
          <p>{$t('gallery.no_items')}</p>
        </div>
      {/if}
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

<Dialog
  open={incompatibleWarningOpen}
  title={$t('gallery.incompatible_warning_title')}
  message={$t('gallery.incompatible_warning_message')}
  confirmText={$t('common.confirm')}
  cancelText={$t('common.cancel')}
  variant="danger"
  onconfirm={() => {
    incompatibleWarningOpen = false;
    if (pendingItem) {
      openPreview(pendingItem);
      pendingItem = null;
    }
  }}
  oncancel={() => {
    incompatibleWarningOpen = false;
    pendingItem = null;
  }}
/>

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

  .items-grid-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .items-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .discovered-section {
    background: rgba(34, 197, 94, 0.05);
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .section-header h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0;
  }

  .section-badge {
    background: rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
  }

  .discovered-section .section-header h2 {
    color: #4ade80;
  }

  .discovered-section .section-badge {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }

  @media (max-width: 768px) {
    .gallery-container {
      padding: 1rem;
    }
    .discovered-section {
      padding: 1rem 0.5rem;
    }

    .filters {
      flex-direction: column;
    }

    .items-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
