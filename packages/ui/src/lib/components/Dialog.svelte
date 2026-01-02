<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import Button from './Button.svelte';
  import { t } from 'svelte-i18n';

  let {
    open = false,
    title,
    message,
    confirmText,
    cancelText,
    loading = false,
    loadingText,
    variant = 'primary',
    width = '400px',
    onconfirm,
    oncancel,
    showCancel = true,
    children,
  } = $props<{
    open?: boolean;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    loading?: boolean;
    loadingText?: string;
    variant?: 'primary' | 'danger' | 'success';
    width?: string;
    onconfirm?: () => void | Promise<void>;
    oncancel?: () => void;
    showCancel?: boolean;
    children?: import('svelte').Snippet;
  }>();

  const handleConfirm = async () => {
    if (onconfirm) {
      await onconfirm();
    }
  };

  const handleCancel = () => {
    if (oncancel) {
      oncancel();
    }
  };
</script>

{#if open}
  <div
    class="backdrop"
    transition:fade={{ duration: 200 }}
    role="button"
    tabindex="0"
    onclick={(e) => {
      if (e.target === e.currentTarget && showCancel !== false) handleCancel();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape' && showCancel !== false) handleCancel();
    }}
  >
    <div
      class="dialog"
      style:max-width={width}
      transition:scale={{ duration: 200, start: 0.95 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      {#if title}
        <h3 id="dialog-title">{title}</h3>
      {/if}

      <div class="content">
        {#if children}
          {@render children()}
        {:else}
          <p>{message}</p>
        {/if}
      </div>

      <div class="actions">
        {#if showCancel !== false}
          <Button variant="secondary" onclick={handleCancel} disabled={loading}>
            {cancelText || $t('common.cancel')}
          </Button>
        {/if}
        <Button {variant} onclick={handleConfirm} disabled={loading}>
          {#if loading}
            <span class="spinner"></span>
            {loadingText || confirmText || $t('common.confirm')}
          {:else}
            {confirmText || $t('common.confirm')}
          {/if}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
  }

  .dialog {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 1.5rem;
    width: 90%;
    box-shadow:
      0 20px 25px -5px rgba(0, 0, 0, 0.1),
      0 10px 10px -5px rgba(0, 0, 0, 0.04);
    color: #f8fafc;
  }

  h3 {
    margin: 0 0 1rem 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .content {
    margin-bottom: 2rem;
    color: #cbd5e1;
    line-height: 1.5;
  }

  .content p {
    margin: 0;
    white-space: pre-wrap;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .spinner {
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
