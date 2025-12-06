# Binary Sensor 스키마 작성법

문 열림, 호출 등 두 상태만 갖는 입력은 `binary_sensor` 엔티티로 정의합니다. `type` 값은 항상 `binary_sensor`이며, 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `unit_of_measurement`, `state_class`, `icon`)를 함께 사용할 수 있습니다.

## 필수 필드
- `state`: 수신 패킷 패턴(`data`, `mask`, `offset`, `inverted`)을 지정해 어떤 패킷이 이 센서의 업데이트인지 식별합니다.

## 옵션 필드
- `state_on`: 켜짐 상태를 나타내는 서명. `offset`과 `data`로 특정 비트를 비교합니다.
- `state_off`: 꺼짐 상태 서명.
- `state_*`는 모두 [`StateSchema`](./lambda.md#stateschema와-statenumschema-필드) 또는 람다(`!lambda`)로 작성할 수 있습니다.

## 예제: 도어벨 패킷 매칭
`hyundai_door.homenet_bridge.yaml`에서는 헤더·푸터를 전역으로 설정하고, 오프셋 0 바이트를 확인해 벨 상태를 판별합니다.【F:packages/core/config/hyundai_door.homenet_bridge.yaml†L17-L38】

```yaml
binary_sensor:
  - id: door_bell
    name: "Door Bell"
    icon: mdi:bell-ring
    state:
      data: [0xB4, 0x00, 0x00]
      mask: [0xB4, 0xFF, 0xFF]
    state_on:
      offset: 0
      data: [0xB5]
    state_off:
      offset: 0
      data: [0xB6]
```

## 작성 체크리스트
1. `mask`를 활용해 공통 헤더를 고정하고 이벤트 바이트만 비교하면 노이즈 패킷을 줄일 수 있습니다.
2. 엣지 케이스가 있을 경우 `state`를 포괄적으로 지정하고 `state_on/off`로 세부 상태를 나눕니다.
3. 입력이 래치형이거나 다중 비트를 사용한다면 `offset`과 `mask`를 주석으로 남겨 향후 유지보수를 돕습니다.
