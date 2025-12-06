# Light 스키마 작성법

조명은 `light` 엔티티로 정의합니다. `type`은 `light`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 사용할 수 있습니다.

## 필수 필드
- `state`: 이 조명의 상태를 식별하는 기본 서명.
- 전원 상태 판단용 `state_on`, `state_off` 중 하나 이상.

## 옵션 필드 (상태)
- 밝기: `state_brightness` — [`StateNumSchema`](./lambda.md#stateschema와-statenumschema-필드).
- 색온도(미레드): `state_color_temp` + `min_mireds`, `max_mireds`.
- RGB: `state_red`, `state_green`, `state_blue` — 각각 `StateNumSchema`.
- 화이트 채널: `state_white`.
- 색상 모드: `state_color_mode` (`rgb`, `color_temp`, `white`).
- 효과: `effect_list`(문자열 배열), `state_effect`.

## 옵션 필드 (명령)
- 전원: `command_on`, `command_off`, `command_update`.
- 밝기: `command_brightness`.
- 색온도: `command_color_temp`.
- RGB: `command_red`, `command_green`, `command_blue`.
- 화이트 채널: `command_white`.
- 효과: `command_effect`.
- 전환 시간: `default_transition_length`(초 단위 기본 페이드 값).

모든 `command_*`는 [`CommandSchema`](./lambda.md#commandschema-필드) 또는 람다로 작성할 수 있습니다.

## 예제: 두 채널 동시 제어 람다
`kocom.homenet_bridge.yaml`에서는 한 패킷으로 두 채널을 제어하기 위해 람다에서 다른 조명 상태를 함께 실어 보냅니다.【F:packages/core/config/kocom.homenet_bridge.yaml†L22-L41】

```yaml
light:
  - id: room_0_light_1
    name: "Room 0 Light 1"
    state:
      data: [0x30, 0xd0, 0x00, 0x0e, 0x00]
      mask: [0xff, 0xf0, 0xff, 0xff, 0xff]
    state_on:
      offset: 8
      data: [0xff]
    state_off:
      offset: 8
      data: [0x00]
    command_on: !lambda |-
      const light2 = getEntityState('room_0_light_2');
      const light2_on = light2 && light2.is_on ? 0xff : 0x00;
      return [[0x30, 0xbc, 0x00, 0x0e, 0x00, 0x01, 0x00, 0x00, 0xff, light2_on, 0, 0, 0, 0, 0, 0], [0x30, 0xdc]];
    command_off: !lambda |-
      const light2 = getEntityState('room_0_light_2');
      const light2_on = light2 && light2.is_on ? 0xff : 0x00;
      return [[0x30, 0xbc, 0x00, 0x0e, 0x00, 0x01, 0x00, 0x00, 0x00, light2_on, 0, 0, 0, 0, 0, 0], [0x30, 0xdc]];
```

## 작성 체크리스트
1. 장치가 지원하지 않는 기능(밝기/색온도/RGB)은 필드를 생략해 Home Assistant에서 불필요한 UI를 숨깁니다.
2. `state_color_mode`를 지정하면 상태 패킷에 따라 현재 모드를 정확히 표기할 수 있습니다.
3. 다채널·다기능 조명은 `effect_list`와 람다 명령을 조합해 필요한 패킷을 한 번에 보내도록 설계합니다.
