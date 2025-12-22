# 엔티티 공통 옵션

이 문서는 모든 엔티티 타입(`light`, `switch`, `sensor` 등)에서 공통적으로 사용할 수 있는 설정 옵션들을 설명합니다. 이 옵션들은 엔티티의 기본 식별, Home Assistant 연동, 패킷 처리 방식 등을 제어합니다.

## 기본 식별자

| 옵션명 | 타입 | 설명 | 필수 여부 |
|---|---|---|---|
| `name` | string | 엔티티의 표시 이름입니다. (예: `거실 전등 1`) | **필수** |
| `id` | string | 시스템 내부 및 MQTT 토픽에 사용되는 고유 ID입니다. 지정하지 않으면 `name`을 기반으로 자동 생성됩니다. (예: `living_room_light_1`) | 선택 |
| `unique_id` | string | Home Assistant에서 엔티티를 고유하게 식별하기 위한 ID입니다. 지정하지 않으면 `homenet_{portId}_{id}` 형식으로 자동 생성됩니다. | 선택 |

## Home Assistant 연동 설정

이 옵션들은 Home Assistant의 Discovery 기능을 통해 엔티티가 생성될 때 메타데이터로 사용됩니다.

| 옵션명 | 타입 | 설명 | 예시 |
|---|---|---|---|
| `device_class` | string | Home Assistant [Device Class](https://www.home-assistant.io/integrations/binary_sensor/#device-class)를 지정합니다. 아이콘과 상태 표현 방식이 결정됩니다. | `temperature`, `door`, `window` |
| `icon` | string | Home Assistant에서 표시할 아이콘(MDI)입니다. | `mdi:lightbulb`, `mdi:fan` |
| `area` | string | 엔티티가 위치한 구역(Area)을 제안합니다. | `거실`, `안방` |
| `unit_of_measurement` | string | 센서 값의 단위를 지정합니다. (`sensor` 타입 전용) | `°C`, `%`, `W` |
| `state_class` | string | 통계 처리를 위한 상태 클래스입니다. (`sensor` 타입 전용) | `measurement`, `total_increasing` |

## Discovery 제어

Home Assistant에 엔티티 정보를 발행(Discovery)하는 시점과 방식을 제어합니다.

### `discovery_always`
- **타입**: `boolean`
- **기본값**: `false`
- **설명**: 기본적으로 브릿지는 해당 엔티티의 상태(State) 패킷을 최초 1회 수신한 후에만 Discovery 정보를 발행합니다. 이는 실제 존재하는 장치만 HA에 등록하기 위함입니다. 그러나 상태를 주기적으로 보내지 않는 장치나, 명령만 수행하는 장치의 경우 이 옵션을 `true`로 설정하여 부팅 시 즉시 Discovery를 발행하도록 강제할 수 있습니다.

```yaml
light:
  - name: "현관 일괄소등"
    id: "all_lights_off"
    discovery_always: true  # 상태 확인 없이 항상 HA에 등록
    # ...
```

### `discovery_linked_id`
- **타입**: `string`
- **설명**: 현재 엔티티의 Discovery 발행을 다른 엔티티의 상태 수신 여부에 종속시킵니다. 예를 들어, 메인 장치(`main_device`)가 발견되었을 때만 그 장치의 세부 속성(전압, 전류 등)을 표시하고 싶을 때 사용합니다.

```yaml
sensor:
  - name: "스마트 플러그 전압"
    discovery_linked_id: "smart_plug_1" # smart_plug_1이 발견되면 이 센서도 함께 등록됨
    # ...
```

## 패킷 통신 설정 (`packet_parameters`)

상위 `packet_defaults`에서 정의한 통신 설정을 개별 엔티티 수준에서 오버라이드할 수 있습니다. 특정 장치만 다른 체크섬 방식이나 타이밍을 사용할 때 유용합니다.

| 옵션명 | 설명 |
|---|---|
| `tx_retry_cnt` | 명령 전송 실패 시 재시도 횟수 |
| `tx_timeout` | 응답(ACK/상태변경) 대기 시간 (ms) |
| `tx_delay` | 재시도 간격 (ms) |
| `tx_checksum` | 1바이트 체크섬 알고리즘 (`xor`, `crc8` 등) 또는 CEL 표현식 |
| `tx_checksum2` | 2바이트 체크섬 알고리즘 (1바이트가 `none`일 때 사용) |

```yaml
light:
  - name: "특수 조명"
    packet_parameters:
      tx_retry_cnt: 3
      tx_timeout: 500
      tx_checksum: "xor_0xFF" # 이 장치만 다른 체크섬 사용
```

## 낙관적 상태 업데이트 (`optimistic`)

명령을 보낸 후 장치로부터 상태 변경 응답을 기다리지 않고, 즉시 상태가 변경된 것으로 가정하여 반영합니다.

- **타입**: `boolean`
- **기본값**: `false`
- **설명**: `true`로 설정하면 명령 전송 즉시 UI 상태가 업데이트됩니다.
    - 실제 장치의 응답 속도가 느릴 때 UI 반응성을 높이는 데 유용합니다.
    - `command_on`/`command_off` 등이 정의되지 않은 경우, 패킷을 전송하지 않고 상태만 유지하는 **가상 스위치(Virtual Switch)** 또는 플래그로 활용할 수 있습니다.

```yaml
switch:
  - name: "외출 모드 플래그"
    id: "away_mode_flag"
    optimistic: true  # 가상 스위치로 동작 (패킷 전송 없음)
```
