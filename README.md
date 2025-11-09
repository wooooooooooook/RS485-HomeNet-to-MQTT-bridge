Purpose: RS485 장치를 읽어 MQTT로 퍼블리시하고, Home Assistant에서 MQTT Discovery로 엔티티를 자동 생성하는 브리지.

✅ System Overview

Core: Node.js + TypeScript

Main Role: RS485 → MQTT Bridge

Svelte UI (Ingress-ready), Express service

Deployment: Docker, Home Assistant Add-on

Dev Workflow: Docker Compose + hot reload

Testing: Virtual serial (socat PTY), mock device responder

✅ Key Packages

packages/core: RS485 로직, MQTT 연결, Discovery, 폴링 루프

packages/service: UI/API 제공 서버 (Ingress 호환)

packages/ui: Svelte SPA (상태/옵션 화면)

✅ Core Runtime Environment Variables

SERIAL_PORT=/dev/ttyUSB0

BAUD_RATE=9600

DEVICES=1,2

TOPIC_PREFIX=home/rs485

MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASS

POLL_INTERVAL_MS=1000

INTER_DEVICE_DELAY_MS=250

✅ MQTT Topics

State: home/rs485/<id>/state

Discovery:

Temp: homeassistant/sensor/rs485_<id>_temp/config

Hum: homeassistant/sensor/rs485_<id>_hum/config

✅ Dev Commands

socat -d -d pty,raw,echo=0 pty,raw,echo=0
pnpm service:build (Svelte UI 빌드 및 정적 자산 동기화 포함)

✅ Docker Compose Stack

`deploy/docker/docker-compose.yml`에는 다음 컨테이너가 포함됩니다.

- **simulator**: `@rs485-homenet/simulator`가 생성한 PTY를 `/simshare/rs485-sim-tty` 심볼릭 링크로 노출
- **core**: `SERIAL_PORT=/simshare/rs485-sim-tty`를 통해 시뮬레이터에 연결하고 MQTT 브릿지 + Express API/Svelte UI를 함께 제공 (3000 노출)
- **mq**: Eclipse Mosquitto 브로커 (1883 노출)
- **homeassistant**: Home Assistant 안정 채널 (8123 노출)

실행:

```
cd deploy/docker
docker compose up --build
```

실제 RS485 디바이스를 연결하려면 `core` 서비스 환경변수(`SERIAL_PORT`, `BAUD_RATE`)와 `devices` 매핑을 오버라이드하고, 필요 시 `simulator` 서비스를 scale down 하세요.

✅ Bridge Logic Outline

Load config from env

Connect MQTT

Open Serial

Publish MQTT Discovery per device

Poll devices sequentially

Publish JSON state to <topic_prefix>/<id>/state

✅ Add-on Notes

options.json → env → core

run.sh handles mapping
