# Light 스키마 작성법

조명은 `light` 엔티티로 정의합니다. `type`은 `light`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 사용할 수 있습니다.

## 필수 필드
- `state`: 이 조명의 상태를 식별하는 기본 서명.
- 전원 상태 판단용 `state_on`, `state_off` 중 하나 이상.
- 전원 제어용 `command_on`, `command_off` 중 하나 이상.

## 옵션 필드 (상태)
- 밝기: `state_brightness` — [`StateNumSchema`](./schemas.md#statenumschema).
- 색온도(미레드): `state_color_temp` + `min_mireds`, `max_mireds`.
- RGB: `state_red`, `state_green`, `state_blue` — 각각 `StateNumSchema`.
- 화이트 채널: `state_white`.
- 색상 모드: `state_color_mode` (`rgb`, `color_temp`, `white`).
- 효과: `effect_list`(문자열 배열), `state_effect`.

## 옵션 필드 (명령)
- 밝기: `command_brightness`.
- 색온도: `command_color_temp`.
- RGB: `command_red`, `command_green`, `command_blue`.
- 화이트 채널: `command_white`.
- 효과: `command_effect`.
- 전환 시간: `default_transition_length`(초 단위 기본 페이드 값).

모든 `command_*`는 [`CommandSchema`](./schemas.md#commandschema) 또는 CEL 표현식으로 작성할 수 있습니다.

## MQTT 디스커버리 메시지 구성
- 토픽: `homeassistant/light/<unique_id>/config`
- 공통 필드
  - `name`, `default_entity_id`, `unique_id`
  - `state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `availability`: `${MQTT_TOPIC_PREFIX}/bridge/status`
  - `device`: `devices` 설정 또는 브리지 기본 정보
  - 선택: `suggested_area`, `device_class`, `unit_of_measurement`, `state_class`, `icon`
- 조명 기본 제어/상태
  - `command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/set`
  - `state_value_template`: `{{ value_json.state }}`
  - `payload_on`: `ON`, `payload_off`: `OFF`
- 밝기 지원 시
  - `brightness_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `brightness_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/brightness/set`
  - `brightness_scale`: `255`
  - `brightness_value_template`: `{{ value_json.brightness }}`
- RGB 지원 시
  - `rgb_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `rgb_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/rgb/set`
  - `rgb_value_template`: `{{ value_json.red }},{{ value_json.green }},{{ value_json.blue }}`
- 색온도 지원 시
  - `color_temp_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `color_temp_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/color_temp/set`
  - `color_temp_value_template`: `{{ value_json.color_temp }}`
  - 선택: `min_mireds`, `max_mireds`
- 효과 지원 시
  - `effect_list`
  - `effect_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `effect_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/effect/set`
  - `effect_value_template`: `{{ value_json.effect }}`

## 예제: 두 채널 동시 제어
`kocom.homenet_bridge.yaml`에서는 한 패킷으로 두 채널을 제어하기 위해 CEL 표현식에서 다른 조명 상태(`states`)를 함께 실어 보냅니다.

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
    command_on: >-
      [0x30, 0xbc, 0x00, 0x0e, 0x00, 0x01, 0x00, 0x00, 0xff, get_from_states('room_0_light_2', 'state') == 'ON' ? 0xff : 0x00, 0, 0, 0, 0, 0, 0]
    command_off: >-
      [0x30, 0xbc, 0x00, 0x0e, 0x00, 0x01, 0x00, 0x00, 0x00, get_from_states('room_0_light_2', 'state') == 'ON' ? 0xff : 0x00, 0, 0, 0, 0, 0, 0]
```

## 효과(Effect) 사용법

조명의 효과(패턴, 모드)는 여러 값을 구분해야 하므로 **CEL 표현식**을 사용합니다.

- `effect_list`: UI에 표시할 효과 이름 배열
- `state_effect`: 패킷에서 현재 효과를 파싱하는 CEL 표현식 (문자열 반환)
- `command_effect`: 선택된 효과에 따라 명령 패킷을 생성하는 CEL 표현식

```yaml
light:
  - id: rgb_light
    name: "RGB 조명"
    state:
      data: [0x40, 0x01]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]
    command_on:
      data: [0x40, 0x11, 0x01]
    command_off:
      data: [0x40, 0x11, 0x00]
    
    # 효과 이름 정의
    effect_list: ["Rainbow", "Breathing", "Strobe"]
    
    # 상태 파싱: 패킷 바이트에 따라 문자열 반환
    state_effect: >-
      data[3] == 0x01 ? "Rainbow" : 
      (data[3] == 0x02 ? "Breathing" : "Strobe")
      
    # 명령 생성: 선택된 문자열(xstr)에 따라 바이트 배열 반환
    command_effect: >-
      xstr == "Rainbow" ? [0x40, 0x12, 0x01] : 
      (xstr == "Breathing" ? [0x40, 0x12, 0x02] : [0x40, 0x12, 0x03])
```

**CEL 사용 시 주의사항:**
- **상태(`state_effect`)**: 패킷(`data`)을 분석하여 `effect_list`에 정의한 문자열 중 하나를 반환해야 합니다.
- **명령(`command_effect`)**: 사용자가 UI에서 선택한 문자열(`xstr`)을 인자로 받아 바이트 배열을 반환해야 합니다.
  - ⚠️ 문자열 비교 시 `x`가 아닌 **`xstr`** 변수를 사용합니다.

## 작성 체크리스트
1. 장치가 지원하지 않는 기능(밝기/색온도/RGB)은 필드를 생략해 Home Assistant에서 불필요한 UI를 숨깁니다.
2. `state_color_mode`를 지정하면 상태 패킷에 따라 현재 모드를 정확히 표기할 수 있습니다.
3. 다채널·다기능 조명은 `effect_list`와 CEL 표현식을 조합해 필요한 패킷을 한 번에 보내도록 설계합니다.
4. 효과 명령에서 문자열 비교 시 **`xstr`** 변수를 사용합니다.
