<script lang="ts">
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import Button from './Button.svelte';
  import { copyToClipboard } from '../utils/clipboard';

  let { portId }: { portId: string } = $props();

  let senderHex = $state('');
  let senderOptions = $state({
    header: true,
    footer: true,
    checksum: true,
  });
  let senderSettings = $state({
    interval: 100,
    count: 1,
  });
  let senderPreview = $state<string | null>(null);
  let isSending = $state(false);
  let sendError = $state<string | null>(null);
  let sendSuccessMsg = $state<string | null>(null);
  let previewCopied = $state(false);

  const hexInputId = `hex-input-${Math.random().toString(36).slice(2, 9)}`;
  const errorMsgId = `error-msg-${Math.random().toString(36).slice(2, 9)}`;

  async function updatePreview() {
    if (!senderHex.trim() || !portId) {
      senderPreview = null;
      return;
    }

    try {
      const response = await fetch('./api/tools/packet/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portId,
          hex: senderHex,
          ...senderOptions,
        }),
      });

      const data = await response.json();
      if (data.error) {
        // Don't show error eagerly while typing, just clear preview
        senderPreview = null;
      } else {
        senderPreview = data.preview;
      }
    } catch (e) {
      senderPreview = null;
    }
  }

  // Update preview when inputs change
  $effect(() => {
    // Dependency tracking
    const _ = { hex: senderHex, opt: senderOptions, pid: portId };
    // Debounce slightly
    const timer = setTimeout(updatePreview, 300);
    return () => clearTimeout(timer);
  });

  async function handleCopyPreview(text: string) {
    const success = await copyToClipboard(text);
    if (success) {
      previewCopied = true;
      setTimeout(() => {
        previewCopied = false;
      }, 2000);
    }
  }

  async function sendPacket() {
    if (!senderHex.trim() || !portId) return;

    isSending = true;
    sendError = null;
    sendSuccessMsg = null;

    try {
      const response = await fetch('./api/tools/packet/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portId,
          hex: senderHex,
          ...senderOptions,
          ...senderSettings,
        }),
      });

      const data = await response.json();
      if (data.error) {
        sendError = data.error;
      } else {
        sendSuccessMsg = $t('analysis.raw_log.sender.sent_success', {
          values: { count: data.sentCount },
        });
        // Clear success message after 3 seconds
        setTimeout(() => {
          sendSuccessMsg = null;
        }, 3000);
      }
    } catch (e: any) {
      sendError = e.message || 'Unknown error';
    } finally {
      isSending = false;
    }
  }

  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];
</script>

<div class="sender-section">
  <div class="sender-header">
    <h3>{$t('analysis.raw_log.sender.title')}</h3>
  </div>

  <div class="sender-body">
    <div class="input-row">
      <label class="full-width" for={hexInputId}>
        <span class="label-text">{$t('analysis.raw_log.sender.hex_input_label')}</span>
        <input
          id={hexInputId}
          type="text"
          bind:value={senderHex}
          placeholder={$t('analysis.raw_log.sender.hex_input_placeholder')}
          class="hex-input"
          aria-invalid={!!sendError}
          aria-describedby={sendError ? errorMsgId : undefined}
        />
      </label>
    </div>

    <div class="options-row">
      <div class="opt-group">
        <span class="group-label">{$t('analysis.raw_log.sender.options_label')}</span>
        <button
          type="button"
          class="filter-chip"
          class:active={senderOptions.header}
          aria-pressed={senderOptions.header}
          onclick={() => (senderOptions.header = !senderOptions.header)}
        >
          {$t('analysis.raw_log.sender.option_header')}
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={senderOptions.footer}
          aria-pressed={senderOptions.footer}
          onclick={() => (senderOptions.footer = !senderOptions.footer)}
          disabled={!senderOptions.checksum}
        >
          {$t('analysis.raw_log.sender.option_footer')}
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={senderOptions.checksum}
          aria-pressed={senderOptions.checksum}
          onclick={() => (senderOptions.checksum = !senderOptions.checksum)}
        >
          {$t('analysis.raw_log.sender.option_checksum')}
        </button>
      </div>

      <div class="settings-group">
        <span class="group-label">{$t('analysis.raw_log.sender.settings_label')}</span>
        <div class="setting-inputs">
          <label>
            {$t('analysis.raw_log.sender.count_label')}
            <input type="number" bind:value={senderSettings.count} min="1" max="50" />
          </label>
          <label>
            {$t('analysis.raw_log.sender.interval_label')}
            <input type="number" bind:value={senderSettings.interval} min="10" step="10" />
          </label>
        </div>
      </div>
    </div>

    {#if senderPreview}
      <div class="preview-row" transition:fade>
        <span class="label-text">{$t('analysis.raw_log.sender.preview_label')}:</span>
        <div class="code-wrapper">
          <code class="preview-code">{toHexPairs(senderPreview).join(' ')}</code>
          <button
            class="copy-btn"
            onclick={() => handleCopyPreview(toHexPairs(senderPreview!).join(' '))}
            aria-label={previewCopied ? $t('common.copied') : $t('common.copy')}
            title={previewCopied ? $t('common.copied') : $t('common.copy')}
          >
            {#if previewCopied}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="success-icon"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <div class="action-row">
      <Button
        variant="outline-primary"
        onclick={sendPacket}
        disabled={!senderHex.trim()}
        title={!senderHex.trim() ? $t('analysis.packet_analyzer.input_required') : undefined}
        isLoading={isSending}
      >
        {$t('analysis.raw_log.sender.send_btn')}
      </Button>

      {#if sendError}
        <span id={errorMsgId} class="error-msg" transition:fade role="alert">{sendError}</span>
      {/if}
      {#if sendSuccessMsg}
        <span class="success-msg" transition:fade role="status">{sendSuccessMsg}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .sender-section {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
  }

  @media (max-width: 480px) {
    .sender-section {
      padding: 0.75rem;
      border-radius: 8px;
    }
  }

  .sender-header h3 {
    margin: 0 0 1rem 0;
    font-size: 1.1rem;
    color: #e2e8f0;
  }

  .sender-body {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .input-row {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .full-width {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .label-text {
    font-size: 0.9rem;
    color: #cbd5e1;
    font-weight: 500;
  }

  .hex-input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    border-radius: 8px;
    padding: 0.75rem;
    font-family: monospace;
    font-size: 1rem;
    width: 100%;
    box-sizing: border-box;
  }

  .hex-input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.6);
    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35);
  }

  .options-row {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
    background: rgba(15, 23, 42, 0.3);
    padding: 1rem;
    border-radius: 8px;
  }

  .opt-group,
  .settings-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .group-label {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-bottom: 0.25rem;
    white-space: nowrap;
  }

  .filter-chip {
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    background: rgba(15, 23, 42, 0.6);
    color: #cbd5f5;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
    white-space: nowrap;
  }

  .filter-chip:hover {
    border-color: rgba(148, 163, 184, 0.6);
    color: #e2e8f0;
  }

  .filter-chip.active {
    border-color: rgba(59, 130, 246, 0.7);
    background: rgba(59, 130, 246, 0.2);
    color: #eff6ff;
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.2);
  }

  .filter-chip:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .setting-inputs {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .setting-inputs label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #cbd5e1;
    min-width: 120px;
    flex: 1 1 120px;
  }

  .setting-inputs input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    border-radius: 6px;
    padding: 0.4rem;
    width: 100%;
    max-width: 120px;
    box-sizing: border-box;
  }

  .preview-row {
    background: rgba(16, 185, 129, 0.05);
    border: 1px solid rgba(16, 185, 129, 0.2);
    padding: 0.75rem 1rem;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .preview-code {
    font-family: monospace;
    color: #34d399;
    font-weight: 600;
    word-break: break-all;
  }

  .code-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .copy-btn {
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .copy-btn:hover {
    color: #e2e8f0;
    background: rgba(148, 163, 184, 0.1);
  }

  .success-icon {
    color: #34d399;
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .success-msg {
    color: #34d399;
    font-size: 0.9rem;
  }

  .error-msg {
    color: #f87171;
    font-size: 0.9rem;
  }
</style>
