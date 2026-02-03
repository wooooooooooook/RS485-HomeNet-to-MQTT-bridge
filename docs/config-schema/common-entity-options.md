# 엔티티 공통 옵션

이 문서는 모든 엔티티 타입(`light`, `switch`, `sensor` 등)에서 공통적으로 사용할 수 있는 설정 옵션들을 설명합니다. 이 옵션들은 엔티티의 기본 식별, Home Assistant 연동, 패킷 처리 방식 등을 제어합니다.

## 기본 식별자

| 옵션명      | 타입   | 설명                                                                                                                                                                                                         | 필수 여부 |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `name`      | string | 엔티티의 표시 이름입니다. (예: `거실 전등 1`)                                                                                                                                                                | **필수**  |
| `id`        | string | 시스템 내부 및 MQTT 토픽에 사용되는 고유 ID입니다. 지정하지 않으면 `name`을 기반으로 자동 생성됩니다. (예: `living_room_light_1`)                                                                            | 선택      |
| `unique_id` | string | Home Assistant에서 엔티티를 고유하게 식별하기 위한 ID입니다. 지정하지 않으면 `homenet_{portId}_{id}` 형식으로 자동 생성되며, 중복이 감지되면 충돌을 피하기 위해 접미사(`_2`, `_3` 등)가 자동으로 추가됩니다. | 선택      |

## Home Assistant 연동 설정

이 옵션들은 Home Assistant의 Discovery 기능을 통해 엔티티가 생성될 때 메타데이터로 사용됩니다.

| 옵션명                | 타입   | 설명                                                                                                                                                      | 예시                              |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `device_class`        | string | Home Assistant [Device Class](https://www.home-assistant.io/integrations/binary_sensor/#device-class)를 지정합니다. 아이콘과 상태 표현 방식이 결정됩니다. | `temperature`, `door`, `window`   |
| `icon`                | string | Home Assistant에서 표시할 아이콘(MDI)입니다.                                                                                                              | `mdi:lightbulb`, `mdi:fan`        |
| `area`                | string | 엔티티가 위치한 구역(Area)을 제안합니다.                                                                                                                  | `거실`, `안방`                    |
| `device`              | string | 미리 정의된 `devices` 블록의 ID를 참조하여 장치 정보를 설정합니다.                                                                                        | `living_room_wallpad`             |
| `unit_of_measurement` | string | 센서 값의 단위를 지정합니다. (`sensor` 타입 전용)                                                                                                         | `°C`, `%`, `W`                    |
| `state_class`         | string | 통계 처리를 위한 상태 클래스입니다. (`sensor` 타입 전용)                                                                                                  | `measurement`, `total_increasing` |

## Discovery 제어

Home Assistant에 엔티티 정보를 발행(Discovery)하는 시점과 방식을 제어합니다.

### `discovery_always`

- **타입**: `boolean`
- **기본값**: `false`
- **설명**: 기본적으로 브릿지는 해당 엔티티의 상태(State) 패킷을 최초 1회 수신한 후에만 Discovery 정보를 발행합니다. 이는 실제 존재하는 장치만 HA에 등록하기 위함입니다. 그러나 상태를 주기적으로 보내지 않는 장치나, 명령만 수행하는 장치의 경우 이 옵션을 `true`로 설정하여 부팅 시 즉시 Discovery를 발행하도록 강제할 수 있습니다.

```yaml
light:
  - name: '현관 일괄소등'
    id: 'all_lights_off'
    discovery_always: true # 상태 확인 없이 항상 HA에 등록
    # ...
```

### `discovery_linked_id`

- **타입**: `string`
- **설명**: 현재 엔티티의 Discovery 발행을 다른 엔티티의 상태 수신 여부에 종속시킵니다. 예를 들어, 메인 장치(`main_device`)가 발견되었을 때만 그 장치의 세부 속성(전압, 전류 등)을 표시하고 싶을 때 사용합니다.

```yaml
sensor:
  - name: '스마트 플러그 전압'
    discovery_linked_id: 'smart_plug_1' # smart_plug_1이 발견되면 이 센서도 함께 등록됨
    # ...
```

## 패킷 통신 설정 (`packet_parameters`)

상위 `packet_defaults`에서 정의한 통신 설정을 개별 엔티티 수준에서 오버라이드할 수 있습니다. 특정 장치만 다른 체크섬 방식이나 타이밍을 사용할 때 유용합니다.

| 옵션명         | 설명                                                       |
| -------------- | ---------------------------------------------------------- |
| `tx_header`    | 송신 패킷 앞부분 식별 바이트 배열                          |
| `tx_footer`    | 패킷 종료 시그널 (송신용)                                  |
| `tx_retry_cnt` | 명령 전송 실패 시 재시도 횟수                              |
| `tx_timeout`   | 응답(ACK/상태변경) 대기 시간 (ms)                          |
| `tx_delay`     | 재시도 간격 (ms)                                           |
| `tx_checksum`  | 1바이트 체크섬 알고리즘 (`xor`, `crc8` 등) 또는 CEL 표현식 |
| `tx_checksum2` | 2바이트 체크섬 알고리즘 (1바이트가 `none`일 때 사용)       |

```yaml
light:
  - name: '특수 조명'
    packet_parameters:
      tx_retry_cnt: 3
      tx_timeout: 500
      tx_checksum: 'bitXor(data[0], 0xFF)' # 이 장치만 다른 체크섬 사용 (CEL)
```

## 낙관적 상태 업데이트 (`optimistic`)

명령을 보낸 후 장치로부터 상태 변경 응답을 기다리지 않고, 즉시 상태가 변경된 것으로 가정하여 반영합니다.

- **타입**: `boolean`
- **기본값**: `false`
- **설명**: `true`로 설정하면 명령 전송 즉시 UI 상태가 업데이트됩니다.
  - 실제 장치의 응답 속도가 느릴 때 UI 반응성을 높이는 데 유용합니다.
  - `switch`, `light`, `fan`처럼 `on`/`off` 명령이 있는 엔티티는 `optimistic` 모드에서 즉시 `ON`/`OFF` 상태를 반영합니다.
  - `command_on`/`command_off` 등이 정의되지 않은 경우, 패킷을 전송하지 않고 상태만 유지하는 **가상 스위치(Virtual Switch)** 또는 플래그로 활용할 수 있습니다.

```yaml
switch:
  - name: '외출 모드 플래그'
    id: 'away_mode_flag'
    optimistic: true # 가상 스위치로 동작 (패킷 전송 없음)
```

## 내부 엔티티 (`internal`)

Home Assistant Discovery와 H2M 대시보드에서 해당 엔티티를 숨깁니다. 자동화의 상태 관리 등 내부 용도로만 사용되는 엔티티에 유용합니다.

- **타입**: `boolean`
- **기본값**: `false`
- **설명**: `true`로 설정하면 해당 엔티티가 Home Assistant에 등록되지 않으며, H2M 대시보드의 명령 목록에도 표시되지 않습니다. MQTT를 통한 상태 발행은 정상적으로 이루어지며, 자동화에서 `get_from_states('entity_id', 'state')`로 접근할 수 있습니다.

```yaml
text:
  - id: 'door_state'
    name: '현관문 상태'
    internal: true # HA Discovery 및 H2M 대시보드에서 숨김
    optimistic: true # 패킷 없이 상태 설정 가능
    initial_value: 'IDLE' # 초기 상태
```

### 사용 사례

- 자동화의 상태 머신 (State Machine) 구현
- 내부 플래그 및 변수 저장
- 복잡한 시퀀스 제어를 위한 임시 상태 저장

## 상태 프록시 (`state_proxy`)

서로 다른 종류의 패킷이나 여러 소스로부터 하나의 엔티티 상태를 업데이트해야 할 때 사용합니다. 이 옵션을 사용하면 해당 엔티티는 자신의 상태를 갖지 않고, 파싱된 결과를 지정된 `target_id` 엔티티로 전달합니다.

- **타입**: `boolean`
- **기본값**: `false`
- **설명**: `true`로 설정하면 이 엔티티는 **상태 프록시**로 동작합니다.
  - **자동 내부 설정**: `state_proxy: true`인 엔티티는 기본적으로 `internal: true`로 설정되어 Home Assistant에 노출되지 않습니다.
  - **타겟 지정 필수**: `target_id` 옵션을 통해 상태를 전달할 대상 엔티티를 반드시 지정해야 합니다.
  - **명령 불가**: `command_*` 속성을 가질 수 없으며, 오직 상태 파싱(`state` 또는 `state_*`) 역할만 수행합니다.

### 설정 예시

메인 조명(`main_light`)이 있고, 별도의 상태 알림 패킷을 파싱하는 보조 엔티티가 필요한 경우:

```yaml
light:
  # 1. 메인 엔티티 (실제 제어 및 상태 표시)
  - id: 'main_light'
    name: '거실 메인 조명'
    command_on: ...
    command_off: ...
    state: ... # 일반적인 상태 패킷 파싱

  # 2. 보조 파싱 엔티티 (상태 프록시)
  - name: '거실 조명 추가 상태'
    state_proxy: true # 프록시 모드 활성화
    target_id: 'main_light' # 파싱 결과를 main_light로 전달
    state: ... # 다른 형태의 패킷 파싱 규칙
```

### 사용 사례

- **복합 패킷 처리**: 장치의 상태가 여러 종류의 패킷으로 나누어 들어오는 경우 (예: 기본 상태 패킷 + 상세 정보 패킷).
- **다중 프로토콜 지원**: 하나의 장치가 두 가지 다른 프로토콜로 상태를 보고하는 경우.
- **특수 속성 파싱**: 메인 패킷에는 없는 특정 속성(예: 에어컨의 소비전력)이 별도 패킷으로 오는 경우, 이를 파싱하여 메인 에어컨 엔티티에 병합할 때.

## 디바이스 정의 및 영역 매핑

엔티티별로 다른 디바이스 메타데이터를 사용하거나 영역을 미리 지정하려면 최상위 `devices` 블록과 엔티티의 `device`, `area` 필드를 함께 사용합니다.

```yaml
devices:
  - id: subpanel
    name: '현관 서브패널'
    manufacturer: 'Homenet'
    model: 'Subpanel V2'
    sw_version: '1.0.3'
    area: 'Entrance'

switch:
  - id: entrance_light
    name: '현관 조명'
    type: switch
    device: subpanel
    area: 'Hallway'
```

- **디바이스 참조**: 엔티티에 `device: subpanel`을 지정하면 해당 엔티티의 Discovery 정보에 장치 제조사, 모델명 등이 포함됩니다.
- **영역 매핑**: `area`를 지정하면 Home Assistant의 `suggested_area`로 전달됩니다. 엔티티에 직접 `area`를 지정하면 디바이스에 정의된 `area`보다 우선순위를 가집니다.

## Discovery 토픽 및 문제 해결

브리지는 Home Assistant의 MQTT Discovery 프로토콜을 따르며, 기본적으로 다음 토픽 패턴을 사용합니다:

`homeassistant/<entity_type>/homenet_<entity_id>/config`

### 문제 해결 체크리스트

장치가 Home Assistant에 자동으로 나타나지 않는 경우 다음을 확인하세요:

1. **상태 패킷 수신 대기**: 기본적으로 브리지는 해당 엔티티의 **최초 상태 패킷**을 수신한 후에 Discovery를 발행합니다. 즉시 노출하려면 `discovery_always: true`를 설정하세요.
2. **MQTT 설정**: 브리지가 MQTT 브로커에 정상적으로 연결되었는지, `homeassistant` 토픽으로 메시지를 발행할 권한이 있는지 확인하세요.
3. **토픽 확인**: MQTT Explorer 등의 도구로 `homeassistant/#` 토픽에 설정(config) 메시지가 들어오는지 확인하세요.
4. **ID 충돌**: `unique_id`가 중복되지 않는지 확인하세요. (로그에서 확인 가능)
