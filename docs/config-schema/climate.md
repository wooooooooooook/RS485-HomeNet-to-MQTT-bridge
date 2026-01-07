# Climate 스키마 작성법

난방/냉방 장치는 `climate` 엔티티를 사용합니다. `type`은 `climate`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `unit_of_measurement`, `state_class`, `icon`)를 함께 지정합니다.

## 필수 필드
- `state`: 이 엔티티가 대응하는 상태 패킷을 식별하는 서명.
- **모드 중 최소 하나**: `state_off`, `state_heat`, `state_cool` 등의 모드 상태 정의가 최소 하나 있어야 Home Assistant에서 동작합니다. `state`만으로는 climate 엔티티가 정상 구성되지 않습니다.

## 옵션 필드 (상태)
- 모드 감지: `state_off`, `state_heat`, `state_cool`, `state_fan_only`, `state_dry`, `state_auto`.
- 온도: `state_temperature_current`(현재), `state_temperature_target`(설정값) — [`StateNumSchema`](./schemas.md#statenumschema).
- 습도: `state_humidity_current`, `state_humidity_target` — `StateNumSchema`.
- 동작 상태: `state_action_idle`, `state_action_heating`, `state_action_cooling`, `state_action_drying`, `state_action_fan`.
- 스윙: `state_swing_off`, `state_swing_both`, `state_swing_vertical`, `state_swing_horizontal`.
- 팬 모드: `state_fan_on`, `state_fan_off`, `state_fan_auto`, `state_fan_low`, `state_fan_medium`, `state_fan_high`, `state_fan_middle`, `state_fan_focus`, `state_fan_diffuse`, `state_fan_quiet`.
- 프리셋: `state_preset_none`, `state_preset_home`, `state_preset_away`, `state_preset_boost`, `state_preset_comfort`, `state_preset_eco`, `state_preset_sleep`, `state_preset_activity`.
- 커스텀 모드(CEL): `state_custom_fan`, `state_custom_preset` — 문자열을 반환하는 CEL 표현식으로 표현.

## 옵션 필드 (명령)
- 모드 전환: `command_off`, `command_heat`, `command_cool`, `command_fan_only`, `command_dry`, `command_auto`.
- 온도/습도 설정: `command_temperature`, `command_humidity` — 다음 두 가지 방식 중 선택:
  
  **방식 1: 스키마 기반 (권장)**
  - `data`: 기본 명령 패킷 바이트 배열
  - `value_offset`: 값을 삽입할 바이트 위치 (0부터 시작)
  - `length`: 값이 차지하는 바이트 수 (기본값: 1)
  - `precision`: 소수점 자릿수 (예: 1이면 값에 10을 곱함, 기본값: 0)
  - `endian`: 바이트 순서 (`big` 또는 `little`, 기본값: `big`)
  - `multiply_factor`: 값에 곱할 배수 (기본값: 1)
  - `value_encode`: 인코딩 방식 (`none`, `bcd`, `ascii`, `signed_byte_half_degree`, 기본값: `none`)
  
  **방식 2: CEL 표현식**
  - 문자열로 CEL 표현식 직접 작성. `x` 변수로 입력 온도값을 받아 바이트 배열을 반환.
  - 예: `command_temperature: "[0x30, 0xb8, int(x)]"`
- 스윙 제어: `command_swing_off`, `command_swing_both`, `command_swing_vertical`, `command_swing_horizontal`.
- 팬 속도: `command_fan_on`, `command_fan_off`, `command_fan_auto`, `command_fan_low`, `command_fan_medium`, `command_fan_high`, `command_fan_middle`, `command_fan_focus`, `command_fan_diffuse`, `command_fan_quiet`.
- 프리셋: `command_preset_none`, `command_preset_home`, `command_preset_away`, `command_preset_boost`, `command_preset_comfort`, `command_preset_eco`, `command_preset_sleep`, `command_preset_activity`.
- 커스텀 모드(CEL): `command_custom_fan`, `command_custom_preset` — 문자열 인자를 받아 적절한 바이트로 변환하는 CEL 표현식.

- 커스텀 모드 옵션:
  - `custom_fan_mode`: UI에 표시될 커스텀 팬 모드 이름 목록 (문자열 배열).
  - `custom_preset`: UI에 표시될 커스텀 프리셋 이름 목록 (문자열 배열).

### 팬/프리셋 모드(CEL 포함) 작동 원리

**커스텀 모드는 표준 모드(`off`, `heat`, `cool` 등)와 별개로 동작합니다.** 
- **표준 모드 (`modes`)**: `state_off`, `state_heat`, `state_cool` 등이 정의되어 있으면 자동으로 Home Assistant의 모드 선택기에 추가됩니다.
- **팬 모드 (`fan_modes`)**: `state_fan_*`/`command_fan_*`가 정의된 표준 모드와 `custom_fan_mode` 목록이 함께 Home Assistant의 팬 모드 선택기에 추가됩니다.
- **프리셋 모드 (`preset_modes`)**: `state_preset_*`/`command_preset_*`가 정의된 표준 모드와 `custom_preset` 목록이 함께 Home Assistant의 프리셋 선택기에 추가됩니다.

즉, 장치가 `off`/`heat` 모드와 함께 `Turbo`/`Nature`/`Sleep` 같은 팬 모드를 지원한다면, 두 가지를 모두 설정할 수 있습니다.

**CEL 사용 시 주의사항:**
- **상태(`state_custom_*`)**: 패킷(`data`)을 분석하여 정의한 목록 중 하나의 **문자열**을 반환해야 합니다.
- **명령(`command_custom_*`)**: 사용자가 UI에서 선택한 문자열(`xstr`)을 인자로 받아 전송할 **바이트 배열**(`[0x01, ...]` 등)을 반환해야 합니다.
  - ⚠️ 문자열 비교 시 `x`가 아닌 **`xstr`** 변수를 사용합니다. (예: `xstr == "Turbo"`)

## MQTT 디스커버리 메시지 구성
- 토픽: `homeassistant/climate/<unique_id>/config`
- 공통 필드
  - `name`, `default_entity_id`, `unique_id`
  - `state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `availability`: `${MQTT_TOPIC_PREFIX}/bridge/status`
  - `device`: `devices` 설정 또는 브리지 기본 정보
  - 선택: `suggested_area`, `device_class`, `unit_of_measurement`, `state_class`, `icon`
- 모드/온도 제어
  - `mode_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/mode/set`
  - `temperature_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/temperature/set`
  - `mode_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `mode_state_template`: `{{ value_json.mode }}`
  - `temperature_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `temperature_state_template`: `{{ value_json.target_temperature }}`
  - `current_temperature_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `current_temperature_template`: `{{ value_json.current_temperature }}`
  - 선택: `action_topic` + `action_template` (설정에 `state_action`이 있을 때)
- 가용 모드
  - `modes`: `state_off/state_heat/state_cool/state_fan_only/state_dry/state_auto` 존재 여부로 목록 생성
- 팬/프리셋 모드
  - `fan_modes`: `state_fan_*`/`command_fan_*` 및 `custom_fan_mode` 목록을 합쳐 노출
  - `fan_mode_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/fan_mode/set`
  - `fan_mode_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `fan_mode_state_template`: `{{ value_json.fan_mode }}`
  - `preset_modes`: `state_preset_*`/`command_preset_*` 및 `custom_preset` 목록을 합쳐 노출
  - `preset_mode_command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/preset_mode/set`
  - `preset_mode_state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `preset_mode_state_template`: `{{ value_json.preset_mode }}`
- 고정 값
  - `temperature_unit`: `C`
  - `min_temp`: `15`, `max_temp`: `30`, `temp_step`: `1`

## 예제: 온도·습도 설정
`kocom_thinks.homenet_bridge.yaml`은 현재/목표 온도와 상태 비트를 분리해 읽고, `command_temperature`를 통해 온도를 설정합니다.【F:packages/core/config/examples/kocom_thinks.homenet_bridge.yaml†L601-L641】

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
```

## 예제 2: 커스텀 팬 모드 (CEL 활용)
장치가 '강/중/약' 대신 '터보/자연/수면' 모드를 지원한다고 가정할 때의 설정입니다.

```yaml
climate:
  - id: my_ac
    name: "침실 에어컨"
    state:
      data: [0x20, 0x10, 0x00] # 상태 패킷 식별
    
    # 1. 사용할 모드 이름 정의
    custom_fan_mode: ["Turbo", "Nature", "Sleep"]
    
    # 2. 상태 파싱: 5번 바이트에 따라 위에서 정의한 문자열 중 하나를 반환
    state_custom_fan: >-
      data[5] == 0x03 ? "Turbo" : 
      (data[5] == 0x02 ? "Nature" : "Sleep")
      
    # 3. 명령 생성: 선택된 문자열(xstr)에 따라 다른 패킷 데이터 생성
    command_custom_fan: >-
      xstr == "Turbo" ? [0x20, 0x11, 0x03] : 
      (xstr == "Nature" ? [0x20, 0x11, 0x02] : [0x20, 0x11, 0x01])
```

## 작성 체크리스트
1. 장비가 지원하는 모드만 선택해 `state_*`와 `command_*`를 채우고, 사용하지 않는 모드는 생략합니다.
2. 온도·습도는 장치마다 정밀도/엔디언/디코딩 방식이 다르므로 `StateNumSchema`의 `precision`·`decode`를 맞춥니다.
3. 여러 모드를 한 패킷에서 다룰 때는 `mask`로 비트를 분리하거나 CEL 표현식을 사용해 조건별 패킷을 조립합니다.
