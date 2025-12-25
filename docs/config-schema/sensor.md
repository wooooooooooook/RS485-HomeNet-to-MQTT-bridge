# Sensor 스키마 작성법

온도·층수 등 **수치** 값을 읽는 장치는 `sensor` 엔티티를 사용합니다. `type`은 `sensor`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `unit_of_measurement`, `state_class`, `icon`)를 지정할 수 있습니다.

> 💡 **텍스트 값**을 표시하려면 [`text-sensor`](./text-sensor.md)를 사용하세요.

## 필수 필드
- `state`: 이 센서 값이 포함된 패킷을 식별하는 서명.
- `state_number` 또는 `state_value` (CEL): 수치를 추출하는 방법 (둘 중 하나 필수).
  - `state_number`: [`StateNumSchema`](./schemas.md#statenumschema)로 바이트를 숫자로 변환.
  - `state_value`: CEL 표현식으로 숫자를 반환.

## 예제 1: 스키마 기반 (StateNumSchema)
```yaml
sensor:
  - id: elevator_floors
    name: "Elevator Floors"
    icon: mdi:elevator
    state:
      data: [0x23]
    state_number:
      offset: 2
      length: 1
      precision: 0
```

## 예제 2: CEL 표현식
2바이트를 조합하여 전력량을 계산하는 예시입니다.
```yaml
sensor:
  - id: power_consumption
    name: "전력 소비량"
    unit_of_measurement: "W"
    device_class: power
    state:
      data: [0x31, 0x01]
    state_value: >-
      (data[5] * 256 + data[6]) / 10.0
```

## 작성 체크리스트
1. 데이터가 부호 있는 값이면 `signed: true`를, 소수면 `precision`을 설정합니다.
2. 바이트 직렬화 규칙이 BCD/ASCII라면 `decode`를 지정해 올바르게 파싱합니다.
3. 수집 주기가 긴 장비는 패킷이 올 때까지 기다리거나 전용 앱/패널에서 상태 갱신을 트리거해야 할 수 있습니다.
