# Docker 배포 가이드

`deploy/docker/docker-compose.yml` 또는 `docker-compose.dev.yml`을 이용해 브릿지, MQTT 브로커, Home Assistant, 시뮬레이터를 기동할 수 있습니다. `CONFIG_ROOT` 볼륨을 비워서 올리면 서비스가 초기 설정 마법사 모드로 시작되어 예제 설정을 선택할 수 있습니다.

## 초기화 절차
1. `docker compose up -d`로 컨테이너를 최초 기동합니다. `CONFIG_ROOT`(기본 `/app/packages/core/config`)에 `default.homenet_bridge.yaml`과 `.initialized`가 모두 없으면 `/api/config/examples`가 예제 목록을 반환합니다.
2. UI 또는 API로 원하는 예제 파일명을 `/api/config/examples/select`에 전달하면 `CONFIG_DIR/default.homenet_bridge.yaml`으로 복사되고 `.initialized` 플래그와 `.restart-required`가 생성됩니다.
3. 서비스 프로세스가 종료되면 Compose의 `restart: unless-stopped` 정책에 따라 컨테이너가 자동 재시작되며, 새로 생성된 `default.homenet_bridge.yaml`로 브릿지가 기동됩니다.
4. 추가 설정 파일을 사용하려면 컨테이너 재시작 후 `CONFIG_FILES`(혹은 레거시 `CONFIG_FILE`) 환경 변수를 지정하여 원하는 YAML 목록을 넘기면 됩니다. 기본 번들 예시는 `packages/core/config/commax.homenet_bridge.yaml`이며 추가 샘플은 `packages/core/config/examples/`에 있습니다.

## 설정 파일 우선순위
| 상황 | 우선순위 |
| --- | --- |
| `.initialized` 없음 | 1) `CONFIG_DIR/default.homenet_bridge.yaml` → 2) `CONFIG_FILES`/`CONFIG_FILE` → 3) `CONFIG_DIR` 내 기타 `*.homenet_bridge.yaml` |
| `.initialized` 존재 | 1) `CONFIG_FILES`/`CONFIG_FILE` → 2) `CONFIG_DIR` 내 모든 `*.homenet_bridge.yaml`(기본/레거시 포함) |

## 참고
- 예제 경로: `packages/core/config/examples/`
- 기본 설정 파일: `packages/core/config/commax.homenet_bridge.yaml`
- API는 `http://<HOST>:3000/api/...` 형태로 접근하며, 초기화 단계에서는 `/api/bridge/info`가 `CONFIG_INITIALIZATION_REQUIRED` 오류를 반환합니다.
