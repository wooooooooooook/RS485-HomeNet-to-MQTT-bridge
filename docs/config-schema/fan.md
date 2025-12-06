# Fan 스키마 작성법

환풍기나 공기청정기처럼 속도를 가진 장치는 `fan` 엔티티로 정의합니다.

## 필수 필드
- `id`, `name`
- `state`: 수신 패킷 서명.
- `state_on`/`state_off`: 전원 상태 판별.
- `state_speed`: 현재 속도 값을 읽는 위치. `offset`, `length`, `mapping`을 활용합니다.
- `command_on`, `command_off`: 전원 제어 패킷.
- `command_speed`: 속도 변경 패킷. `value_offset`로 속도 바이트 위치를 지정합니다.

## 옵션 필드
- `state_preset_mode`: 장치가 자체 프리셋(예: "수면")을 제공할 때 사용.
- `supported_features`: `SET_SPEED`, `SET_PRESET_MODE` 등 지원 기능을 명시.

## 기본 예제 (3단 속도)
`cvnet.homenet_bridge.yaml`에서는 3단계 속도(저/중/고)를 `mapping`으로 대응시킵니다.

```yaml
fan:
  - id: bathroom_fan
    name: "욕실 환풍기"
    supported_features: [SET_SPEED]
    state:
      data: [0xf7, 0x02, 0x2d, 0x00, 0x00]
    state_on:
      offset: 8
      data: [0x01]
    state_off:
      offset: 8
      data: [0x00]
    state_speed:
      offset: 9
      length: 1
      mapping:
        0x01: low
        0x02: medium
        0x03: high
    command_on:
      data: [0xaa, 0x2d, 0x01]
    command_off:
      data: [0xaa, 0x2d, 0x00]
    command_speed:
      data: [0xaa, 0x2d, 0x00]
      value_offset: 2
```

## 확장 예제 (바이패스 모드 + 업데이트)
`samsung_sds.homenet_bridge.yaml`에서는 속도 외에 바이패스 모드(`preset_mode`)를 함께 제공하며, 상태 재요청 버튼을 별도로 둡니다.

```yaml
fan:
  - id: ventilation
    name: "환기"
    supported_features: [SET_SPEED, SET_PRESET_MODE]
    state:
      data: [0x20, 0x0b, 0x00, 0x00, 0x00]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]
    state_speed:
      offset: 3
      mapping:
        0x01: low
        0x02: medium
        0x03: high
    state_preset_mode:
      offset: 4
      mapping:
        0x00: normal
        0x01: bypass
    command_on:
      data: [0x20, 0x0b, 0x01]
    command_off:
      data: [0x20, 0x0b, 0x00]
    command_speed:
      data: [0x20, 0x0b, 0x00]
      value_offset: 2
    command_preset_mode:
      data: [0x20, 0x0c, 0x00]
      value_offset: 2
```

## 작성 체크리스트
1. 속도값이 단순 증감인지, 고정 매핑인지 확인해 `mapping` 또는 `value_offset`만으로 처리할지 결정합니다.
2. 전원 상태와 속도 오프셋이 동일할 수 있으므로 패킷을 캡쳐해 비트를 정확히 구분합니다.
3. 상태 패킷과 명령 패킷의 헤더/푸터가 다르면 해당 엔티티 블록 안에서 `packet_defaults`를 재정의합니다.
