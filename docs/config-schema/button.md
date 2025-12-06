# Button 스키마 작성법

벨/문열림 등 단순 트리거를 보내는 장치는 `button` 엔티티를 사용합니다. `type`은 `button`이며, 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 지정할 수 있습니다.

## 필수 필드
- `command_press`: 버튼 눌림 시 송신할 패킷. [`CommandSchema`](./lambda.md#commandschema-필드) 또는 람다로 작성합니다.

## 옵션 필드
- 추가 필드는 없지만, `command_press`에 `homenet_logic`을 넣어 다중 패킷 전송이나 엔티티 상태 조건부 전송을 구성할 수 있습니다.

## 예제: 공동 현관 문열림 명령
`hyundai_door.homenet_bridge.yaml`은 두 가지 버튼을 정의하고, 고정 데이터 배열로 문열림 명령을 보냅니다.【F:packages/core/config/hyundai_door.homenet_bridge.yaml†L40-L51】

```yaml
button:
  - id: door_open_common
    name: "Door Open Common"
    icon: mdi:door-sliding-open
    command_press:
      data: [0x61, 0x00, 0x00]
  - id: door_open_single
    name: "Door Open"
    icon: mdi:door-sliding-open
    command_press:
      data: [0xB4, 0x00, 0x00]
```

## 작성 체크리스트
1. 버튼은 상태를 가지지 않으므로 `state` 블록을 넣지 않습니다.
2. 장비가 응답 패킷을 요구한다면 `packet_defaults.tx_checksum`과 헤더/푸터를 상위에서 맞춰준 뒤, `command_press`에 필요한 바이트만 넣습니다.
3. 누름 시간에 따라 다른 명령이 필요하면 `command_press: !lambda` 안에서 `x` 값을 확인해 분기합니다.
