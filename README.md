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

docker compose -f deploy/docker/docker-compose.yml up --build
socat -d -d pty,raw,echo=0 pty,raw,echo=0

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