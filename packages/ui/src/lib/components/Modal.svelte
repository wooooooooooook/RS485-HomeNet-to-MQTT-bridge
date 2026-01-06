<script lang="ts">
  import { scale } from 'svelte/transition';

  let {
    open = false,
    width = 'fit-content',
    onclose,
    oncancel,
    children,
    lockScroll = true,
  } = $props<{
    open?: boolean;
    width?: string;
    onclose?: () => void; // User initiated close (click backdrop, formatting)
    oncancel?: () => void; // Native cancel (Esc key)
    children?: import('svelte').Snippet;
    lockScroll?: boolean;
  }>();

  let dialog = $state<HTMLDialogElement>();
  let isMouseDownBackdrop = false;

  $effect(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog && dialog.open) {
      dialog.close();
    }
  });

  const isEventOnBackdrop = (e: MouseEvent) => {
    if (!dialog || e.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      e.clientY < rect.top ||
      e.clientY > rect.top + rect.height ||
      e.clientX < rect.left ||
      e.clientX > rect.left + rect.width
    );
  };

  const handleMouseDown = (e: MouseEvent) => {
    isMouseDownBackdrop = isEventOnBackdrop(e);
  };

  const handleBackdropClick = (e: MouseEvent) => {
    if (isEventOnBackdrop(e) && isMouseDownBackdrop) {
      if (onclose) onclose();
    }
    isMouseDownBackdrop = false;
  };
</script>

{#if open}
  <dialog
    bind:this={dialog}
    class="common-modal"
    style:width={width === 'fit-content' ? 'fit-content' : '100%'}
    style:max-width={width}
    transition:scale={{ duration: 200, start: 0.95 }}
    onmousedown={handleMouseDown}
    onclick={handleBackdropClick}
    onclose={() => {
      // Native close event (e.g. from form method="dialog" or direct .close() call if not managed)
      // We sync our open state if needed, but usually we rely on reactive statements.
      // If the user pressed ESC, oncancel fires first, then onclose.
      if (open && onclose) onclose();
    }}
    oncancel={(e) => {
      // ESC key pressed
      e.preventDefault(); // update: we prevent default to control closing manually via props usually,
      // but let's allow it if oncancel/onclose is provided.
      // Actually, standard Svelte pattern: let parent handle logic.
      if (oncancel) {
        oncancel();
      } else if (onclose) {
        onclose();
      }
    }}
  >
    {@render children?.()}
  </dialog>
{/if}

<style>
  dialog.common-modal {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 0;
    color: #f8fafc;
    margin: auto;
    max-height: 90dvh;
    overflow: auto;
    box-shadow:
      0 20px 25px -5px rgba(0, 0, 0, 0.1),
      0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }

  /* Reset default styles that might interfere */
  dialog.common-modal:focus-visible {
    outline: none;
  }

  /* Backdrop styling */
  dialog.common-modal::backdrop {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
    animation: fade-in 0.2s ease-out;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
