# Number 스키마 작성법

임계값·단계 수치를 설정하는 장치는 `number` 엔티티를 사용합니다. `type`은 `number`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `unit_of_measurement`, `state_class`, `icon`)를 함께 지정합니다.

## 필수 필드
- `state`: 이 숫자 값이 포함된 패킷을 식별하는 서명(생략 시 명령만 존재하는 가상 입력으로 사용 가능).
- 현재 값: `state_number` — [`StateNumSchema`](./schemas.md#statenumschema)로 실제 수치를 읽음.

## 옵션 필드 (상태)
- 범위: `max_value`, `min_value`, `step` — UI 슬라이더/스핀박스 범위를 정의.
- 증감 상태: `state_increment`, `state_decrement`, `state_to_min`, `state_to_max` — 증감 버튼이 있는 장치의 이벤트 패킷을 감지.

## 옵션 필드 (명령)
- 값 설정: `command_number` — 입력값을 패킷에 삽입하거나 CEL 표현식으로 조합.
  - `data`: 기본 명령 패킷 바이트 배열
  - `value_offset`: 값을 삽입할 바이트 위치 (0부터 시작)
  - `length`: 값이 차지하는 바이트 수 (기본값: 1)
  - `precision`: 소수점 자릿수 (예: 1이면 값에 10을 곱함, 기본값: 0)
  - `endian`: 바이트 순서 (`big` 또는 `little`, 기본값: `big`)
  - `multiply_factor`: 값에 곱할 배수 (기본값: 1)
  - `value_encode`: 인코딩 방식 (`none`, `bcd`, `ascii`, `signed_byte_half_degree`, 기본값: `none`)

## MQTT 디스커버리 메시지 구성
- 토픽: `homeassistant/number/<unique_id>/config`
- 공통 필드
  - `name`, `default_entity_id`, `unique_id`
  - `state_topic`: `${MQTT_TOPIC_PREFIX}/${id}/state`
  - `availability`: `${MQTT_TOPIC_PREFIX}/bridge/status`
  - `device`: `devices` 설정 또는 브리지 기본 정보
  - 선택: `suggested_area`, `device_class`, `unit_of_measurement`, `state_class`, `icon`
- 숫자 입력 전용
  - `command_topic`: `${MQTT_TOPIC_PREFIX}/${id}/set`
  - `value_template`: `{{ value_json.value }}`
  - 선택: `min`/`max`/`step` (각각 `min_value`/`max_value`/`step`에서 매핑)
  - `mode`: `slider`

## 예제: 난방 설정값 슬라이더 (예시)
```yaml
number:
  - id: heater_setpoint
    name: "난방 설정온도"
    unit_of_measurement: "°C"
    min_value: 5
    max_value: 35
    step: 0.5
    state:
      data: [0x30, 0xd0, 0x00, 0x36, 0x00]
    state_number:
      offset: 10
      length: 1
      precision: 0
    command_number:
      data: [0x30, 0xb8, 0x00, 0x36, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]
      value_offset: 9
```

## 작성 체크리스트
1. 슬라이더 단위와 실제 패킷 단위가 다르면 `value_encode`나 `multiply_factor`를 사용해 변환합니다.
2. 증감 버튼이 있는 장비는 `state_increment/decrement`를 별도로 넣어 UI와 실제 버튼 이벤트를 동기화합니다.
3. 최대/최소 범위를 설정해 Home Assistant가 잘못된 값을 전송하지 않도록 방지합니다.
