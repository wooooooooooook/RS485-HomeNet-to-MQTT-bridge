<script lang="ts">
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
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

  const handleCloseAttempt = () => {
    if (showCancel !== false) {
      handleCancel();
    }
  };
</script>

<Modal {open} {width} onclose={handleCloseAttempt} oncancel={handleCloseAttempt}>
  <div class="dialog-content">
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
</Modal>

<style>
  .dialog-content {
    padding: 1.5rem;
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
