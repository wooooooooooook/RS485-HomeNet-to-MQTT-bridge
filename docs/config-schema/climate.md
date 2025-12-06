# Climate 스키마 작성법

난방/냉방 장치는 `climate` 엔티티를 사용합니다. `type`은 `climate`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `unit_of_measurement`, `state_class`, `icon`)를 함께 지정합니다.

## 필수 필드
- `state`: 이 엔티티가 대응하는 상태 패킷을 식별하는 서명.

## 옵션 필드 (상태)
- 모드 감지: `state_off`, `state_heat`, `state_cool`, `state_fan_only`, `state_dry`, `state_auto`.
- 온도: `state_temperature_current`(현재), `state_temperature_target`(설정값) — [`StateNumSchema`](./lambda.md#stateschema와-statenumschema-필드).
- 습도: `state_humidity_current`, `state_humidity_target` — `StateNumSchema`.
- 동작 상태: `state_action_idle`, `state_action_heating`, `state_action_cooling`, `state_action_drying`, `state_action_fan`.
- 스윙: `state_swing_off`, `state_swing_both`, `state_swing_vertical`, `state_swing_horizontal`.
- 팬 모드: `state_fan_on`, `state_fan_off`, `state_fan_auto`, `state_fan_low`, `state_fan_medium`, `state_fan_high`, `state_fan_middle`, `state_fan_focus`, `state_fan_diffuse`, `state_fan_quiet`.
- 프리셋: `state_preset_none`, `state_preset_home`, `state_preset_away`, `state_preset_boost`, `state_preset_comfort`, `state_preset_eco`, `state_preset_sleep`, `state_preset_activity`.
- 커스텀 모드(람다): `state_custom_fan`, `state_custom_preset` — 문자열을 반환하는 람다로 표현.

## 옵션 필드 (명령)
- 모드 전환: `command_off`, `command_heat`, `command_cool`, `command_fan_only`, `command_dry`, `command_auto`.
- 온도/습도 설정: `command_temperature`, `command_humidity` — 입력값을 `value_offset` 등으로 삽입.
- 스윙 제어: `command_swing_off`, `command_swing_both`, `command_swing_vertical`, `command_swing_horizontal`.
- 팬 속도: `command_fan_on`, `command_fan_off`, `command_fan_auto`, `command_fan_low`, `command_fan_medium`, `command_fan_high`, `command_fan_middle`, `command_fan_focus`, `command_fan_diffuse`, `command_fan_quiet`.
- 프리셋: `command_preset_none`, `command_preset_home`, `command_preset_away`, `command_preset_boost`, `command_preset_comfort`, `command_preset_eco`, `command_preset_sleep`, `command_preset_activity`.
- 커스텀 모드(람다): `command_custom_fan`, `command_custom_preset` — 문자열 인자를 받아 적절한 바이트로 변환.
- 기타: `command_update`(상태 재요청).

## 기타 옵션
- `custom_fan_mode`, `custom_preset`: 커스텀 모드 목록. 프론트엔드에 노출되는 문자열 배열.

## 예제: 온도·습도 + 업데이트 요청
`kocom_thinks.homenet_bridge.yaml`은 현재/목표 온도와 상태 비트를 분리해 읽고, `command_update`로 상태 재요청 패킷을 보냅니다.【F:packages/core/config/kocom_thinks.homenet_bridge.yaml†L601-L641】

```yaml
climate:
  - id: room_0_heater
    name: "방0 난방"
    state:
      data: [0x30, 0xd0, 0x00, 0x36, 0x00]
    state_temperature_current:
      offset: 12
      length: 1
    state_temperature_target:
      offset: 10
      length: 1
    state_action_heating:
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
1. 장비가 지원하는 모드만 선택해 `state_*`와 `command_*`를 채우고, 사용하지 않는 모드는 생략합니다.
2. 온도·습도는 장치마다 정밀도/엔디언/디코딩 방식이 다르므로 `StateNumSchema`의 `precision`·`decode`를 맞춥니다.
3. 여러 모드를 한 패킷에서 다룰 때는 `mask`로 비트를 분리하거나 [`CommandLambdaConfig`](./lambda.md#commandlambdaconfig)를 사용해 조건별 패킷을 조립합니다.
