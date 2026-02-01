# Development Guide

This guide describes how to set up the development environment for RS485 HomeNet Bridge.

## Project Structure

This project is a Monorepo managed by `pnpm` and `turbo`.

- `packages/core`: Core logic (Protocol parsing, Device management, MQTT bridge).
- `packages/service`: Express API server and Static file server (serves UI).
- `packages/ui`: Svelte-based Frontend SPA.
- `packages/simulator`: Virtual RS485 device simulator for testing.
- `deploy/docker`: Docker build resources.

## Prerequisites

- **Node.js**: v20 or higher.
- **pnpm**: Package manager.
- **Mosquitto**: MQTT Broker (required for local messaging).

## Local Development (No Docker)

This method allows you to run the stack directly on your machine, which is faster for debugging logic.

### 1. Setup Mosquitto

Install and start a local MQTT broker.

**Ubuntu/Debian:**
```bash
sudo apt-get update && sudo apt-get install -y mosquitto mosquitto-clients
sudo systemctl start mosquitto
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build the Project

Build all packages (Core, Service, UI).

```bash
pnpm build
```

> **Note:** `packages/ui` is built into `packages/ui/dist`, which is then copied to `packages/service/static` by the service build script.

### 4. Create Test Config

Create a config file in `packages/core/config/test.homenet_bridge.yaml`.

```yaml
homenet_bridge:
  serial:
    path: localhost:8888  # Connects to Simulator (TCP)
    portId: test_port
  packet_defaults:
    rx_timeout: 10ms
    # ... other defaults
```

### 5. Run the Stack

Run each component in a separate terminal.

**Terminal 1: Simulator**
```bash
SIMULATOR_PROTOCOL=tcp pnpm --filter @rs485-homenet/simulator start
```

**Terminal 2: Service (Backend + UI)**
```bash
CONFIG_FILE=./packages/core/config/test.homenet_bridge.yaml MQTT_URL=mqtt://localhost:1883 pnpm --filter @rs485-homenet/service start
```

Open http://localhost:3000 to view the app. The service serves the built UI from Step 3.

### 6. Frontend Development (HMR)

If you want to modify the UI with Hot Module Replacement (HMR):

1.  Run the Service (Backend) as above (Terminal 2).
2.  Run the UI Dev Server in a **new terminal**:

```bash
VITE_API_URL=http://localhost:3000 pnpm --filter @rs485-homenet/ui dev
```

Open http://localhost:5173. The UI will proxy API requests to the backend on port 3000.

## Local Development (With Docker)

If you prefer using Docker Compose to isolate the environment:

```bash
# Start App, Simulator, and MQTT
pnpm dev:up

# View Logs
pnpm dev:logs

# Stop
pnpm dev:down
```

## Testing

**Run Unit Tests:**
```bash
pnpm test
```

**Run Tests for Specific Package:**
```bash
pnpm --filter @rs485-homenet/core test
```

**Linting:**
```bash
pnpm lint
```

## Schema Generation

If you modify `packages/core/src/config/types.ts`, regenerate the JSON schema:

```bash
pnpm schema:build
```
