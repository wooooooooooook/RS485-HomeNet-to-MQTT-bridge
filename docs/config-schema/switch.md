# Switch 스키마 작성법

On/Off 토글 장치는 `switch` 엔티티를 사용합니다. `type`은 `switch`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 지정합니다.

## 필수 필드
- `state`: 이 스위치가 포함된 패킷을 구분하는 서명.

## 옵션 필드
- 전원 상태: `state_on`, `state_off` — [`StateSchema`](./lambda.md#stateschema와-statenumschema-필드) 또는 CEL 표현식.
- 명령: `command_on`, `command_off`(필요 시 `value_offset`/`homenet_logic` 사용), `command_update`(상태 재요청).

## 예제: 도어 호출 스위치
`hyundai_door.homenet_bridge.yaml`은 호출 스위치에 온/오프 패킷을 배치하고 상태 비트로 켜짐 여부를 확인합니다.【F:packages/core/config/hyundai_door.homenet_bridge.yaml†L52-L69】

```yaml
switch:
  - id: door_call_common
    name: "Door Call Common"
    icon: mdi:phone
    state:
      data: [0x5F, 0x00, 0x00]
    state_on:
      offset: 0
      data: [0x5F]
    state_off:
      offset: 0
      data: [0x60]
    command_on:
      data: [0x5F, 0x00, 0x00]
    command_off:
      data: [0x60, 0x00, 0x00]
```

## 작성 체크리스트
1. 상태 패킷과 명령 패킷의 헤더/체크섬 규칙이 다르면 엔티티별 `packet_parameters`를 사용해 상위 기본값을 덮어씁니다.
2. 전원 비트 외에 추가 상태가 있을 경우 `state`에 `mask`를 걸어 노이즈를 제거합니다.
3. 토글 시 다른 엔티티 상태를 함께 맞춰야 한다면 `command_on/off`를 람다로 작성해 여러 패킷을 동시에 반환합니다.
