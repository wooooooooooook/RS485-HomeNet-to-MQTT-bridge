<script lang="ts">
  let serialPath = '';
  let baudRate = 9600;
  let mqttUrl = '';

  async function startBridge() {
    const response = await fetch('/api/bridge/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ serialPath, baudRate, mqttUrl }),
    });

    if (!response.ok) {
      const message = await response.text();
      alert(`Failed to start bridge: ${message}`);
      return;
    }

    alert('Bridge started successfully');
  }
</script>

<main>
  <h1>RS485 HomeNet Bridge</h1>
  <form on:submit|preventDefault={startBridge} class="form">
    <label>
      Serial Path
      <input bind:value={serialPath} placeholder="/dev/ttyUSB0" />
    </label>

    <label>
      Baud Rate
      <input type="number" bind:value={baudRate} min="0" step="1" />
    </label>

    <label>
      MQTT URL
      <input bind:value={mqttUrl} placeholder="mqtt://localhost" />
    </label>

    <button type="submit">Start Bridge</button>
  </form>
</main>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    margin: 0;
    background: #0f172a;
    color: #e2e8f0;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
  }

  main {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.4);
    padding: 2rem;
    border-radius: 1rem;
    box-shadow: 0 20px 45px rgba(15, 23, 42, 0.5);
    width: min(90vw, 420px);
  }

  h1 {
    margin-top: 0;
    margin-bottom: 1.5rem;
    font-size: 1.8rem;
    text-align: center;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.95rem;
  }

  input {
    padding: 0.75rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.5);
    background: rgba(15, 23, 42, 0.7);
    color: #e2e8f0;
  }

  button {
    padding: 0.75rem;
    border-radius: 9999px;
    border: none;
    background: linear-gradient(135deg, #2563eb, #7c3aed);
    color: white;
    cursor: pointer;
    font-weight: 600;
    letter-spacing: 0.05em;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  button:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 24px rgba(59, 130, 246, 0.35);
  }
</style>
