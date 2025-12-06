# Binary Sensor 스키마 작성법

문 열림/도어벨/모션 감지처럼 2가지 상태를 가지는 센서는 `binary_sensor` 블록으로 정의합니다.

## 필수 필드
- `id`: MQTT 엔티티 ID.
- `name`: 표시 이름.
- `state`: 수신 패킷 매칭 조건. `data`와 `mask`를 통해 패킷 서명과 오프셋을 정의합니다.
- `state_on`, `state_off`: 센서가 켜짐/꺼짐 상태로 판단되는 바이트 패턴.

## 옵션 필드
- `device_class`: Home Assistant용 센서 타입(예: `door`, `occupancy`).
- `state_delay`: 장치가 연속으로 동일 패킷을 보낼 때 중복 처리를 줄이기 위한 지연.

## 기본 예제 (현관 초인종)
`packages/core/config/hyundai_door.homenet_bridge.yaml`에서는 도어벨을 아래처럼 정의합니다. `state`로 벨 채널을 매칭하고, `state_on`에서 초인종 이벤트를 감지합니다.

```yaml
binary_sensor:
  - id: bell_room0
    name: "초인종"
    device_class: occupancy
    state:
      data: [0x7f, 0x00, 0x00, 0x00, 0x00]
      mask: [0xff, 0xff, 0x00, 0x00, 0x00]
    state_on:
      offset: 1
      data: [0x01]
    state_off:
      offset: 1
      data: [0x00]
```

## 멀티채널 예제 (도어벨 + 공동 현관)
여러 채널을 구분할 때는 `state`의 `data`/`mask`로 채널 비트를 분리하고, 각 센서마다 다른 `offset`이나 `data`를 줍니다. 아래는 `packages/core/config/kocom_door.homenet_bridge.yaml`에서 벨과 공동 현관을 별도 센서로 등록한 형태입니다.

```yaml
binary_sensor:
  - id: doorbell
    name: "세대 초인종"
    state:
      data: [0xaa, 0x55, 0x01, 0x00]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]

  - id: lobby_bell
    name: "공동 현관 벨"
    state:
      data: [0xaa, 0x55, 0x02, 0x00]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]
```

## 작성 체크리스트
1. `state` 패턴이 너무 광범위하면 다른 패킷을 모두 잡아내므로 `mask`를 적극적으로 활용합니다.
2. 장치에서 이벤트가 짧게 발생하는 경우 `state_delay`를 사용해 중복 트리거를 줄이고, MQTT 전송 폭주를 방지합니다.
3. 동일한 오프셋을 여러 센서가 공유할 때는 `data`를 달리해 충돌을 막습니다.
