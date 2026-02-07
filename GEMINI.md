**Always respond with 한국어**

# Gemini Project Analysis

This document provides a comprehensive overview of the `homenet2mqtt` project, intended to be used as a context for AI-driven development.

## Project Overview

This project is a TypeScript-based monorepo managed with pnpm. It serves as a bridge between RS485 devices and an MQTT broker. The primary goal is to read data from RS485 devices, publish it to MQTT topics, and enable automatic discovery of these devices in Home Assistant.

For configuration details regarding Home Assistant Discovery, please see [HOMEASSISTANT_DISCOVERY.md](HOMEASSISTANT_DISCOVERY.md).

The project is structured as a monorepo with the following key packages:

-   `packages/core`: Handles the core logic of connecting to the RS485 device, communicating with the MQTT broker, and managing the polling loop.
-   `packages/service`: An Express-based web server that provides an API and serves the Svelte-based user interface.
-   `packages/ui`: A Svelte single-page application for monitoring and configuring the bridge.
-   `packages/simulator`: A tool to simulate an RS485 device for development and testing.

The entire development environment is containerized using Docker and managed with Docker Compose, providing a consistent and reproducible setup.

## Building and Running

The project uses pnpm for package management and scripting.

### Development

The recommended way to start the development environment is by using the provided Docker Compose setup:

```bash
# Start the development environment in detached mode
pnpm dev:up

# View logs from all services
pnpm dev:logs

# Stop the development environment
pnpm dev:down
```

This will start the following services:

-   `mq`: Eclipse Mosquitto MQTT broker.
-   `homeassistant`: A Home Assistant instance for integration testing.
-   `simulator`: The RS485 device simulator.
-   `core`: The main application, including the web server and UI.

### Building

To build all packages in the monorepo, run the following command from the root of the project:

```bash
pnpm build
```

You can also build individual packages:

```bash
# Build the core package
pnpm core:build

# Build the service package (which also builds the UI)
pnpm service:build

# Build the UI package
pnpm ui:build
```

### Testing

The project uses `vitest` for testing. To run all tests, use the following command:

```bash
pnpm test
```

## Development Conventions

-   **Monorepo:** The project is a pnpm monorepo, with shared configurations for Prettier and TypeScript.
-   **TypeScript:** All packages are written in TypeScript.
-   **Docker-centric workflow:** The primary development and deployment workflow is based on Docker and Docker Compose.
-   **Hot Reloading:** The development setup supports hot reloading for the `core` and `service` packages.
-   **Conventional Commits:** While not explicitly enforced, the presence of a well-structured commit history is encouraged.
-   **Code Formatting:** Code is formatted with Prettier. You can format the entire project by running `pnpm format`.
-   **Linting:** The project uses the TypeScript compiler for linting. You can lint the entire project by running `pnpm lint`.

---

# Local Test Environment Setup (Without Docker)

This document guides you through setting up and running the full "Homenet2MQTT" application stack in a local environment without using Docker.

## Prerequisites

- **Node.js and pnpm**: The project's primary runtime and package manager.
- **Mosquitto MQTT Broker**: Serves as the local message broker.

## Setup Steps

1.  **Install and Run Mosquitto**:
    -   `sudo apt-get update && sudo apt-get install -y mosquitto mosquitto-clients`
    -   `sudo systemctl start mosquitto`

2.  **Install Dependencies**:
    -   Run `pnpm install` in the project root directory.

3.  **Build the Project**:
    -   Run `pnpm build` to build all packages. The `service` package builds the `ui` package and copies its output to its own `static` directory.

4.  **Create a Test Configuration File**:
    -   In the `packages/core/config/` directory, create a test configuration file, such as `test.homenet_bridge.yaml`.
    -   Set the `serial.path` in this file to `localhost:8888` to connect to the local simulator.

5.  **Run the Application Stack**:
    -   **Start the Simulator**: `SIMULATOR_PROTOCOL=tcp pnpm --filter @rs485-homenet/simulator start &`
    -   **Start the Service**: `CONFIG_FILE=./packages/core/config/test.homenet_bridge.yaml MQTT_URL=mqtt://localhost:1883 pnpm --filter @rs485-homenet/service start &`
    -   **Important**: Do not run the `ui` development server (`pnpm --filter @rs485-homenet/ui dev`) separately. The `service` already provides the UI on port 3000.

6.  **Verification**:
    -   Open your browser and navigate to `http://localhost:3000` to confirm that the UI loads correctly.
