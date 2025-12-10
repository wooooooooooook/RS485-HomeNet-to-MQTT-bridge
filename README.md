[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge)

# RS485 HomeNet to MQTT Bridge

RS485 기반 HomeNet 장비에서 수집한 프레임을 MQTT 브로커로 전달하고, Home Assistant에서 자동으로 발견할 수 있는 토픽을 발행하는 TypeScript 모노레포입니다. 코어 브릿지, Express API, Svelte UI, 시뮬레이터가 `pnpm` 워크스페이스로 묶여 있습니다.

## 프로젝트 개요
- `packages/core`: 시리얼↔MQTT 브릿지, 엔티티 상태 머신, Home Assistant Discovery.
- `packages/service`: Express API + WebSocket, UI 정적 파일 제공.
- `packages/ui`: Svelte SPA로 패킷 모니터링과 설정 뷰 제공.
- `packages/simulator`: 개발용 RS485 PTY 시뮬레이터.
- `deploy/docker/`: 개발/운영용 Docker Compose, Mosquitto 설정.
- `docs/`: 프로토콜, 디스커버리, 기기 타입별 설정 등을 정리한 문서.

## 빠른 시작
```bash
pnpm install
# 필요 시 .env를 작성하고 환경변수를 채웁니다 (아래 예시 참고)
pnpm dev:up         # 브릿지, 시뮬레이터, HA, MQTT, UI를 컨테이너로 기동
pnpm dev:logs       # 모든 서비스 로그 확인
pnpm dev:down       # 개발용 컨테이너 정리
```
로컬 실행 시 `packages/core` 또는 `packages/service` 폴더에서 `pnpm dev`를 사용해도 됩니다.

### 주요 스크립트
- `pnpm core:dev | service:dev | ui:dev`: 각 패키지의 파일 감시 모드.
- `pnpm build`: 모든 워크스페이스 컴파일 (`dist/`, Vite 번들 생성).
- `pnpm lint`: TypeScript 타입 검사 및 `svelte-check`.
- `pnpm test`: Vitest 전역 테스트.
- `pnpm dev:backend`: MQTT/시뮬레이터/코어 컨테이너만 띄우고 UI는 로컬에서 개발.
- `pnpm clean`: 잔여 볼륨 및 캐시 정리 스크립트.

## 설정
환경 변수는 `.env` 또는 도커 컴포즈 override 파일에서 정의하며, 민감 정보는 버전에 포함하지 마세요.

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `SERIAL_PORTS` (`SERIAL_PORT` 호환) | 쉼표로 구분된 RS485 장치 경로 목록 (`/dev/ttyUSB0,/dev/ttyUSB1` 또는 `192.168.0.83:8888,192.168.0.84:8888`). 단일 값도 허용되지만 경고 로그가 출력됩니다. `CONFIG_FILES`와 개수가 맞아야 합니다. | `/simshare/rs485-sim-tty` |
| `SERIAL_PATH_WAIT_TIMEOUT_MS` | 시작 시 시리얼 경로를 기다리는 최대 시간 | `15000` |
| `MQTT_URL` | MQTT 브로커 URL | `mqtt://mq:1883` |
| `MQTT_USER`/`MQTT_PASSWD` | 브로커 인증 정보 | unset |
| `MQTT_TOPIC_PREFIXES` (`MQTT_TOPIC_PREFIX` 호환) | 상태/명령 토픽 접두사 배열. 항목이 1개면 모든 포트에 공통 적용, 2개 이상이면 `serials` 순서와 길이가 같아야 합니다. | `homenet` |
| `MQTT_CONNECT_TIMEOUT_MS` | MQTT 연결 타임아웃(ms) | `10000` |
| `CONFIG_FILES` (`CONFIG_FILE` 호환) | 사용할 `homenet_bridge.yaml` 절대/상대 경로를 쉼표로 나열합니다. 첫 번째 항목이 기본값으로 사용되며 `SERIAL_PORTS` 길이와 일치해야 합니다. | `packages/core/config/${SYSTEM_TYPE}.homenet_bridge.yaml` |
| `SYSTEM_TYPE` | Docker 개발 환경에서 참조할 기기 타입 식별자 | unset |
| `LOG_LEVEL` | `pino` 로거 레벨 (`trace`~`fatal`) | `info` |
| `PORT` | Express API 및 UI 프록시 포트 | `3000` |
| `CONFIG_ROOT` | API에서 노출할 설정 디렉터리 | `packages/core/config` |
| `VITE_API_URL` | UI 개발 서버에서 프록시할 API URL | `http://app:3000` |

시뮬레이터 전용 변수: `SIMULATOR_DEVICE`(기본 `commax`), `SIMULATOR_INTERVAL_MS`, `SIMULATOR_PROTOCOL`, `SIMULATOR_LINK_PATH`. 도커 개발 스택은 `SYSTEM_TYPE` 값을 시뮬레이터와 코어에 동시에 전달합니다.

### 예시 `.env`
```env
SERIAL_PORTS=/dev/ttyUSB0,/dev/ttyUSB1
CONFIG_FILES=packages/core/config/kocom.homenet_bridge.yaml,packages/core/config/samsung_sds.homenet_bridge.yaml
MQTT_URL=mqtt://192.168.1.2:1883
MQTT_USER=homenet
MQTT_PASSWD=super-secret
SYSTEM_TYPE=kocom
MQTT_TOPIC_PREFIXES=apt_a,apt_b
LOG_LEVEL=debug
```

`SERIAL_PORTS`와 `CONFIG_FILES`의 순서는 1:1로 대응하며, `MQTT_TOPIC_PREFIXES`는 1개 또는 `serials` 길이에 맞춰 나열해야 포트-토픽 매핑이 올바르게 동작합니다. 단일 값 입력은 기존 변수(`SERIAL_PORT`, `CONFIG_FILE`, `MQTT_TOPIC_PREFIX`)를 통해서도 유지되지만 향후 복수 포트를 대비해 배열 형식을 권장합니다.

### 기기 타입별 설정
장비 프로토콜마다 별도의 YAML이 필요합니다. 지원 목록과 시리얼 파라미터, 엔티티 구성을 [docs/DEVICE_SETTINGS.md](docs/DEVICE_SETTINGS.md)에서 확인한 뒤 `SYSTEM_TYPE` 또는 `CONFIG_FILE`을 맞춰 주세요. 새 타입을 추가한다면 동일 문서와 설정 디렉터리에 함께 반영합니다.

### Docker / Home Assistant
- 개발용: `deploy/docker/docker-compose.dev.yml`에서 Home Assistant, Mosquitto, 시뮬레이터, UI가 함께 기동합니다. `SYSTEM_TYPE`을 `.env`에 지정하면 해당 구성 파일이 자동 바인딩됩니다.
- 운영용: `deploy/docker/docker-compose.yml`은 브릿지와 MQTT 브로커만 포함합니다. Home Assistant는 외부 인스턴스에 연결하세요.
- Home Assistant Discovery MQTT 스키마는 [docs/HOMEASSISTANT_DISCOVERY.md](docs/HOMEASSISTANT_DISCOVERY.md)에 상세히 기술되어 있습니다.

## 개발 워크플로
1. `pnpm install`로 루트 의존성을 설치합니다.
2. `pnpm core:dev`로 브릿지 로직을, `pnpm service:dev`로 API를 독립 실행할 수 있습니다.
3. UI는 `pnpm ui:dev -- --host 0.0.0.0`으로 실행하며 `VITE_API_URL`을 API 주소로 지정합니다.
4. Vitest는 `packages/core/test/*` 중심으로 구성되어 있으니, 새로운 프로토콜이나 엔티티 로직을 추가할 때 모킹 기반 테스트를 추가하세요.

## 추가 리소스
- Home Assistant MQTT Discovery: `docs/HOMEASSISTANT_DISCOVERY.md`
- 엔티티 정의 예시: `docs/ENTITY_EXAMPLES.md`
- Lambda DSL 참고: `docs/LAMBDA.md`
- 기기 타입별 설정: `docs/DEVICE_SETTINGS.md`
- Hass.io 애드온: `hassio-addon/` (Home Assistant OS에서 직접 실행 시)

## 라이선스
이 프로젝트는 MIT License를 따릅니다.
