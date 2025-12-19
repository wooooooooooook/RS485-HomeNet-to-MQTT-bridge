# 기기 타입별 설정

아래 목록은 `SYSTEM_TYPE` 또는 `CONFIG_FILES` 환경변수로 선택할 수 있는 HomeNet 기기 타입과 해당 YAML 설정 파일을 정리한 것입니다. 기본 설정은 `packages/core/config/commax.homenet_bridge.yaml`, 예제 설정은 `packages/core/config/examples/*.homenet_bridge.yaml`에 위치하며, `pnpm dev:up` 실행 시 `CONFIG_FILES`(첫 번째 항목)와 `SYSTEM_TYPE`을 통해 도커 서비스가 올바른 구성을 주입합니다.

| 시스템 타입 (`SYSTEM_TYPE`) | 설정 파일 경로 | 시리얼 기본값 | 주 엔티티 구성 | 비고 |
| --- | --- | --- | --- | --- |
| `commax` | `packages/core/config/commax.homenet_bridge.yaml` | 9600 8N1, 헤더 없음, add 체크섬 | 조명, 일괄소등, 난방 | 조명·난방 상태 패킷을 세밀한 마스크로 분리 |
| `cvnet` | `packages/core/config/examples/cvnet.homenet_bridge.yaml` | 9600 8N1, `0xF7`/`0xAA` 헤더·푸터 | 다채널 조명, 난방 | 패킷마다 `add_no_header` 체크섬과 ACK 매칭 필요 |
| `ezville` | `packages/core/config/examples/ezville.homenet_bridge.yaml` | 9600 8N1, `xor_add` 체크섬 | 조명, 난방 | 일부 조명은 inverted 상태 비트를 사용 |
| `hyundai_imazu` | `packages/core/config/examples/hyundai_imazu.homenet_bridge.yaml` | 9600 8N1, XOR 체크섬 | 콘센트 전력 센서, 스위치 | 실시간 전력량 계산을 위해 센서/스위치 묶음 제공 |
| `hyundai_door` | `packages/core/config/examples/hyundai_door.homenet_bridge.yaml` | 3880 8N1, `0x7F`/`0xEE` 헤더·푸터 | 도어벨 바이너리 센서, 문 개폐 버튼 | 도어폰 호출 명령과 공용 채널 분리 |
| `kocom` | `packages/core/config/examples/kocom.homenet_bridge.yaml` | 9600 8N1, `0xAA55` 헤더, add 체크섬 | 다구역 조명, 난방 | 조명 명령은 다른 스위치 상태를 참조하도록 CEL 표현식 사용 |
| `kocom_door` | `packages/core/config/examples/kocom_door.homenet_bridge.yaml` | 9600 8N1, `0x0D0D` 푸터 | 도어벨/도어락 센서·버튼 | 설치 현장의 벨/공용 채널을 분리 보고 |
| `kocom_theart` | `packages/core/config/examples/kocom_theart.homenet_bridge.yaml` | 9600 8N1, `0xAA55` 헤더, add 체크섬 | 대형 거실 조명 그룹 | RX 길이 21바이트 고정, `command_update` 제공 |
| `kocom_thinks` | `packages/core/config/examples/kocom_thinks.homenet_bridge.yaml` | 9600 8N1, `0xAA55` 헤더, add 체크섬 | 거실 조명 + 바닥 난방 | `command_update`로 동시 상태 갱신 |
| `samsung_sds` | `packages/core/config/examples/samsung_sds.homenet_bridge.yaml` | 9600 8E1, 커스텀 체크섬 | 가스밸브 버튼, 조명 | `samsung_rx/tx` 전용 체크섬 구현 필요 |
| `samsung_sds_door` | `packages/core/config/examples/samsung_sds_door.homenet_bridge.yaml` | 9600 8E1 | 도어벨 바이너리 센서, 문자 센서 | XOR 기반 CEL 체크섬과 응답 상태 파서 포함 |

## 설정 선택 가이드

1. **도커 개발 환경**: `.env` 또는 쉘에 `SYSTEM_TYPE=<타입>`을 지정하면 `CONFIG_FILE=packages/core/config/<타입>.homenet_bridge.yaml`이 자동으로 주입됩니다.
2. **직접 실행**: `CONFIG_FILES`(혹은 호환 키 `CONFIG_FILE`) 환경변수에 절대경로나 상대경로를 쉼표로 나열하면 각 설정 파일별로 개별 브릿지가 띄워집니다. 포트/엔티티가 뒤섞이지 않도록 YAML을 포트 단위로 관리하세요.
3. **MQTT 토픽 접두사**: 토픽 접두사는 환경변수 `MQTT_TOPIC_PREFIX`로만 지정하며, 최종 토픽은 `${MQTT_TOPIC_PREFIX}/{portId}/{entityId}/...` 형태로 발행됩니다. 설정 파일에는 접두사를 넣지 마세요.
3. **새 기기 추가**: 기존 YAML을 복사해 시리얼 파라미터와 엔티티 블록을 맞춘 뒤, `docs/ENTITY_EXAMPLES.md`에 정의된 엔티티 스키마를 따라 항목을 추가하세요.

각 기기 타입의 세부 엔티티 구조는 설정 파일 자체에 주석으로 서술되어 있으니, 커스텀 로직을 작성하기 전 반드시 참고하십시오.
