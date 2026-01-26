<script lang="ts">
  import { t } from 'svelte-i18n';

  let { logRetentionEnabled }: { logRetentionEnabled: boolean } = $props();

  const chips = $derived([
    { id: 'packet-log', label: $t('analysis.packet_log.title') },
    { id: 'packet-sender', label: $t('analysis.raw_log.sender.title') },
    { id: 'raw-packet-log', label: $t('analysis.raw_log.title') },
    ...(logRetentionEnabled
      ? [{ id: 'packet-dictionary', label: $t('analysis.packet_dictionary.title') }]
      : []),
    { id: 'packet-analyzer', label: $t('analysis.packet_analyzer.title') },
    { id: 'cel-analyzer', label: $t('analysis.cel_analyzer.title') },
  ]);

  function scrollToSection(id: string) {
    const element = document.getElementById(id);
    const container = document.querySelector('.main-content');
    if (!element || !container) return;

    const CHIP_BAR_HEIGHT = 56; // height of the chip bar
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Calculate position relative to container
    const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
    const offsetPosition = relativeTop - CHIP_BAR_HEIGHT;

    container.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
  }

  function handleWheel(e: WheelEvent) {
    // If the scroll is already predominantly horizontal, let the browser handle it (e.g. trackpads)
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

    const container = e.currentTarget as HTMLElement;
    container.scrollLeft += e.deltaY;
    e.preventDefault();
  }
</script>

<div class="chip-bar-container">
  <div class="chip-bar" onwheel={handleWheel}>
    {#each chips as chip}
      <button class="chip" onclick={() => scrollToSection(chip.id)}>
        {chip.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .chip-bar-container {
    position: sticky;
    top: -2rem;
    z-index: 20;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(12px);
    margin: -2rem 0 0;
    padding: 0.75rem 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }
  @media (max-width: 768px) {
    .chip-bar-container {
      top: -0.75rem;
      margin: -0.75rem 0 0;
    }
  }

  .chip-bar {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE/Edge */
    padding-bottom: 2px;
  }

  .chip-bar::-webkit-scrollbar {
    display: none; /* Chrome/Safari */
  }

  .chip {
    flex: 0 0 auto;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #cbd5e1;
    padding: 0.4rem 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .chip:hover {
    background: rgba(51, 65, 85, 0.8);
    border-color: rgba(148, 163, 184, 0.4);
    color: #f1f5f9;
  }

  .chip:active {
    transform: scale(0.95);
  }
</style>
