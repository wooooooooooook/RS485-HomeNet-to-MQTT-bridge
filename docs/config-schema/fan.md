# Fan 스키마 작성법

환기/공조 팬은 `fan` 엔티티로 정의합니다. `type`은 `fan`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 사용할 수 있습니다.

## 필수 필드
- `state`: 팬 상태를 구분하는 기본 패킷 서명.

## 옵션 필드 (상태)
- 전원 상태: `state_on`, `state_off`.
- 속도(백분율): `state_speed` 또는 `state_percentage` — [`StateNumSchema`](./lambda.md#stateschema와-statenumschema-필드).
- 프리셋: `preset_modes`(문자열 배열), `state_preset_mode`.
- 회전: `state_oscillating`(좌우 회전 여부), `state_direction`(정/역회전).

## 옵션 필드 (명령)
- 전원: `command_on`, `command_off`.
- 속도/백분율 설정: `command_speed`, `command_percentage` — 입력값을 오프셋에 삽입하거나 람다로 구성.
- 프리셋 설정: `command_preset_mode`.
- 회전 제어: `command_oscillating`, `command_direction`.
- 기타: `command_update`(상태 재요청).

## 예제: 속도 제어 람다
`cvnet.homenet_bridge.yaml`은 온/오프 패킷과 별도로 `command_speed` 람다로 목표 속도를 삽입하고, `state_speed`로 현재 속도를 읽습니다.【F:packages/core/config/cvnet.homenet_bridge.yaml†L84-L121】

```yaml
fan:
  - id: fan_1
    name: "Fan 1"
    state:
      data: [0x20, 0x01, 0x71]
    state_on:
      offset: 4
      data: [0x01]
    state_off:
      offset: 4
      data: [0x00]
    command_on:
      data: [0x20, 0x71, 0x01, 0x11, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]
    command_off:
      data: [0x20, 0x71, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    command_speed: !lambda |-
      var speed = x;
      return [[0x20, 0x71, 0x01, 0x11, 0x01, 0x01, speed, 0x00, 0x00, 0x00, 0x00, 0x00], [0x20, 0x01, 0x71, 0x91]];
    state_speed:
      offset: 6
```

## 작성 체크리스트
1. 속도 값 단위가 퍼센트인지 단계형(1~3단)인지 장비별로 확인하고 `value_encode`나 매핑을 맞춥니다.
2. 프리셋 모드를 쓸 경우 `preset_modes` 배열을 노출해야 UI에서 선택할 수 있습니다.
3. 회전/방향과 속도 명령이 한 패킷에 묶인 장비는 [`CommandLambdaConfig`](./lambda.md#commandlambdaconfig)로 여러 값을 삽입합니다.
