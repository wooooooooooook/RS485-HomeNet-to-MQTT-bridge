<script lang="ts">
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

<div class="modal-backdrop">
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="consent-title"
    aria-describedby="consent-desc"
  >
    <h2 id="consent-title">로그 및 데이터 공유 동의</h2>
    <p id="consent-desc">
      서비스 품질 향상과 문제 해결을 위해 익명화된 데이터를 수집하여 개발자에게 전송합니다.
    </p>

    <div class="details">
      <h3>수집 항목</h3>
      <ul>
        <li>시스템 실행 환경 (아키텍처, HA Supervisor 여부)</li>
        <li>애드온 및 패키지 버전 정보</li>
        <li>설정 파일 내용 (YAML 구성)</li>
        <li>수신 패킷 데이터 (최초 1000개)</li>
        <li>애플리케이션 실행 로그</li>
      </ul>

      <h3>수집 시점</h3>
      <p>
        동의 시점부터 패킷 수집이 시작되며, <strong>1000개의 패킷이 모이면 1회 전송</strong> 후 자동으로 수집이 종료됩니다. 지속적으로 감시하거나 수집하지 않습니다.
      </p>

      <p class="privacy-note">
        * 개인정보는 포함되지 않으며, 설정에서 언제든지 변경할 수 있습니다.
      </p>
    </div>

    <div class="actions">
      <button onclick={() => handleConsent(false)} disabled={isConsenting} class="secondary">
        거절
      </button>
      <button onclick={() => handleConsent(true)} disabled={isConsenting} class="primary">
        동의 및 시작
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
