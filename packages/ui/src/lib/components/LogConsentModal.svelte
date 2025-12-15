<script lang="ts">
  let { onclose } = $props<{ onclose: () => void }>();

  let isConsenting = $state(false);

  const handleConsent = async (consent: boolean) => {
    isConsenting = true;
    try {
      await fetch('/api/log-sharing/consent', {
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

<div class="modal-backdrop">
  <div class="modal">
    <h2>로그 및 데이터 공유 동의</h2>
    <p>
      서비스 품질 향상과 문제 해결을 위해 로그와 패킷 데이터(최초 1000개)를 수집하여
      개발자에게 전송하고자 합니다.
    </p>
    <p class="details">
      수집 항목: 시스템 아키텍처, 애드온 버전, 수신 패킷(1000개), 애플리케이션 로그.<br />
      개인정보는 포함되지 않으며, 설정에서 언제든지 변경할 수 있습니다.
    </p>

    <div class="actions">
      <button onclick={() => handleConsent(false)} disabled={isConsenting} class="secondary">
        거절
      </button>
      <button onclick={() => handleConsent(true)} disabled={isConsenting} class="primary">
        동의 및 활성화
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .modal {
    background: #1e293b;
    padding: 2rem;
    border-radius: 1rem;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    border: 1px solid #334155;
  }

  h2 {
    margin-top: 0;
    color: #f8fafc;
  }

  p {
    color: #cbd5e1;
    line-height: 1.6;
  }

  .details {
    font-size: 0.9rem;
    color: #94a3b8;
    background: rgba(15, 23, 42, 0.5);
    padding: 1rem;
    border-radius: 0.5rem;
    margin: 1rem 0 2rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
  }

  button {
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    border: none;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary {
    background: #3b82f6;
    color: white;
  }

  .primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .secondary {
    background: transparent;
    color: #94a3b8;
    border: 1px solid #475569;
  }

  .secondary:hover:not(:disabled) {
    background: #334155;
    color: white;
  }
</style>
