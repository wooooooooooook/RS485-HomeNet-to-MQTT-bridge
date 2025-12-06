# Climate 스키마 작성법

난방/냉난방 제어는 `climate` 엔티티로 정의하며, 현재 온도·목표 온도·모드 상태를 모두 매핑해야 합니다.

## 필수 필드
- `id`, `name`
- `state`: 장비가 주기적으로 보내는 상태 패킷 서명.
- `state_temperature_current`: 현재 온도 위치. `offset`, `length`, `precision`(소수점 자리) 설정.
- `state_temperature_target`: 목표 온도 위치.
- `state_action`: 동작 상태(`HEATING`, `OFF` 등) 판단용 필드.
- `command_temperature`: 목표 온도를 설정하는 송신 패킷.

## 옵션 필드
- `visual`: UI에 노출할 온도 범위, 스텝(`min_temperature`, `max_temperature`, `temperature_step`).
- `command_mode`: 난방/냉방/꺼짐 모드를 전환할 때 사용.
- `command_update`: 상태 갱신을 강제로 요청하는 패킷.

## 기본 예제 (목표/현재 온도 + 모드)
`commax.homenet_bridge.yaml`은 목표 온도와 현재 온도를 각각 1바이트로 읽고, 모드를 `state_action`으로 매핑합니다.

```yaml
climate:
  - id: heater_living
    name: "거실 난방"
    visual:
      min_temperature: 5 °C
      max_temperature: 35 °C
      temperature_step: 1 °C
    state:
      data: [0xf7, 0x02, 0x0f, 0xff, 0x00]
    state_temperature_current:
      offset: 10
      length: 1
      precision: 0
    state_temperature_target:
      offset: 11
      length: 1
      precision: 0
    state_action:
      offset: 8
      data: [0x80]
      mask: [0x80]
    command_temperature:
      data: [0xaa, 0x0f, 0x01, 0x00]
      value_offset: 3
```

## 확장 예제 (난방 밸브 + 업데이트 요청)
`kocom_thinks.homenet_bridge.yaml`에서는 밸브 구역 코드와 온도를 함께 전송하며, `command_update`로 상태 새로고침 패킷을 별도로 지정합니다.

```yaml
climate:
  - id: room_0_heater
    name: "방0 난방"
    visual:
      min_temperature: 5 °C
      max_temperature: 30 °C
      temperature_step: 1 °C
    state:
      data: [0x30, 0xd0, 0x00, 0x36, 0x00]
    state_temperature_current:
      offset: 12
      length: 1
      precision: 0
    state_temperature_target:
      offset: 10
      length: 1
      precision: 0
    state_action:
      offset: 8
      data: [0x80]
      mask: [0x80]
    command_temperature:
      data: [0x30, 0xb8, 0x00, 0x36, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]
      value_offset: 9
    command_update:
      data: [0x30, 0xdc]
```

## 작성 체크리스트
1. `state_action`은 장치마다 비트 위치가 다르므로 `mask`를 사용해 정확히 분리합니다.
2. 목표 온도 바이트가 명령 패킷 어디에 들어가는지 `value_offset`/`length`를 맞춰야 합니다.
3. 동일한 구역 코드가 필요하면 `data` 내 지역 인덱스 값(예: `0x00`, `0x01`)을 상단 주석으로 정리해 혼동을 줄입니다.
