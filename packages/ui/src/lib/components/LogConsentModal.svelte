<script lang="ts">
  import { t } from 'svelte-i18n';
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';

  let { onclose } = $props<{ onclose: () => void }>();

  let isConsenting = $state(false);

  const handleConsent = async (consent: boolean) => {
    isConsenting = true;
    try {
      await fetch('./api/log-sharing/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      });
      onclose();
    } catch (err) {
      console.error(err);
    } finally {
      isConsenting = false;
    }
  };
</script>

<Modal
  open={true}
  width="500px"
  {onclose}
  ariaLabelledBy="consent-title"
  ariaDescribedBy="consent-desc"
>
  <div class="consent-content">
    <h2 id="consent-title">{$t('settings.log_sharing.consent_modal.title')}</h2>
    <p id="consent-desc">
      {$t('settings.log_sharing.consent_modal.desc')}
    </p>

    <div class="details">
      <h3>{$t('settings.log_sharing.consent_modal.collection_items_title')}</h3>
      <ul>
        <li>{$t('settings.log_sharing.consent_modal.collection_item_1')}</li>
        <li>{$t('settings.log_sharing.consent_modal.collection_item_2')}</li>
        <li>{$t('settings.log_sharing.consent_modal.collection_item_3')}</li>
        <li>{$t('settings.log_sharing.consent_modal.collection_item_4')}</li>
        <li>{$t('settings.log_sharing.consent_modal.collection_item_5')}</li>
      </ul>

      <h3>{$t('settings.log_sharing.consent_modal.collection_timing_title')}</h3>
      <p>
        {@html $t('settings.log_sharing.consent_modal.collection_timing')}
      </p>

      <p class="privacy-note">
        {$t('settings.log_sharing.consent_modal.privacy_note')}
      </p>
    </div>

    <div class="actions">
      <Button
        variant="secondary"
        onclick={() => handleConsent(false)}
        disabled={isConsenting}
        class="action-btn"
      >
        {$t('settings.log_sharing.consent_modal.decline')}
      </Button>
      <Button
        variant="primary"
        onclick={() => handleConsent(true)}
        disabled={isConsenting}
        class="action-btn"
      >
        {$t('settings.log_sharing.consent_modal.accept')}
      </Button>
    </div>
  </div>
</Modal>

<style>
  .consent-content {
    padding: 2rem;
    color: #f8fafc;
  }

  h2 {
    margin-top: 0;
    color: #f8fafc;
  }

  p {
    color: #cbd5e1;
    line-height: 1.6;
    margin: 0.5rem 0;
  }

  .details {
    font-size: 0.95rem;
    color: #94a3b8;
    background: rgba(15, 23, 42, 0.5);
    padding: 1.25rem;
    border-radius: 0.5rem;
    margin: 1.5rem 0;
  }

  .details h3 {
    margin: 0 0 0.75rem 0;
    color: #e2e8f0;
    font-size: 1rem;
  }

  .details ul {
    margin: 0 0 1.5rem 0;
    padding-left: 1.25rem;
  }

  .details li {
    margin-bottom: 0.4rem;
  }

  .privacy-note {
    font-size: 0.85rem;
    color: #64748b;
    margin-top: 1rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
  }

  :global(.action-btn) {
    padding: 0.75rem 1.5rem !important;
  }
</style>
