# Number 스키마 작성법

임계값·단계 수치를 설정하는 장치는 `number` 엔티티를 사용합니다. `type`은 `number`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `unit_of_measurement`, `state_class`, `icon`)를 함께 지정합니다.

## 필수 필드
- `state`: 이 숫자 값이 포함된 패킷을 식별하는 서명(생략 시 명령만 존재하는 가상 입력으로 사용 가능).

## 옵션 필드 (상태)
- 범위: `max_value`, `min_value`, `step` — UI 슬라이더/스핀박스 범위를 정의.
- 증감 상태: `state_increment`, `state_decrement`, `state_to_min`, `state_to_max` — 증감 버튼이 있는 장치의 이벤트 패킷을 감지.
- 현재 값: `state_number` — [`StateNumSchema`](./lambda.md#stateschema와-statenumschema-필드)로 실제 수치를 읽음.

## 옵션 필드 (명령)
- 값 설정: `command_number` — 입력값을 패킷에 삽입하거나 람다로 조합.
- 상태 요청: `command_update` — 장치에 현재 값을 다시 보내달라고 요청.

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
