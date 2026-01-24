<script lang="ts">
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import Button from './Button.svelte';

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
      <label class="full-width">
        <span class="label-text">{$t('analysis.raw_log.sender.hex_input_label')}</span>
        <input
          type="text"
          bind:value={senderHex}
          placeholder={$t('analysis.raw_log.sender.hex_input_placeholder')}
          class="hex-input"
          aria-invalid={!!sendError}
        />
      </label>
    </div>

    <div class="options-row">
      <div class="opt-group">
        <span class="group-label">{$t('analysis.raw_log.sender.options_label')}</span>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={senderOptions.header} />
          <span>{$t('analysis.raw_log.sender.option_header')}</span>
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={senderOptions.footer}
            disabled={!senderOptions.checksum}
          />
          <span>{$t('analysis.raw_log.sender.option_footer')}</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={senderOptions.checksum} />
          <span>{$t('analysis.raw_log.sender.option_checksum')}</span>
        </label>
      </div>

      <div class="settings-group">
        <span class="group-label">{$t('analysis.raw_log.sender.settings_label')}</span>
        <div class="setting-inputs">
          <label>
            {$t('analysis.raw_log.sender.interval_label')}
            <input type="number" bind:value={senderSettings.interval} min="10" step="10" />
          </label>
          <label>
            {$t('analysis.raw_log.sender.count_label')}
            <input type="number" bind:value={senderSettings.count} min="1" max="50" />
          </label>
        </div>
      </div>
    </div>

    {#if senderPreview}
      <div class="preview-row" transition:fade>
        <span class="label-text">{$t('analysis.raw_log.sender.preview_label')}:</span>
        <code class="preview-code">{toHexPairs(senderPreview).join(' ')}</code>
      </div>
    {/if}

    <div class="action-row">
      <Button
        variant="primary"
        onclick={sendPacket}
        disabled={!senderHex.trim()}
        isLoading={isSending}
      >
        {$t('analysis.raw_log.sender.send_btn')}
      </Button>

      {#if sendError}
        <span class="error-msg" transition:fade role="alert">{sendError}</span>
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
    flex-direction: column;
    gap: 0.5rem;
  }

  .group-label {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-bottom: 0.25rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #cbd5e1;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .checkbox-label input:disabled + span {
    opacity: 0.5;
  }

  .setting-inputs {
    display: flex;
    gap: 1rem;
  }

  .setting-inputs label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #cbd5e1;
  }

  .setting-inputs input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    border-radius: 6px;
    padding: 0.4rem;
    width: 80px;
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
