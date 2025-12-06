# Sensor 스키마 작성법

온도·층수 등 수치 또는 텍스트 값을 읽는 장치는 `sensor` 엔티티를 사용합니다. `type`은 `sensor`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `unit_of_measurement`, `state_class`, `icon`)를 지정할 수 있습니다.

## 필수 필드
- `state`: 이 센서 값이 포함된 패킷을 식별하는 서명.

## 옵션 필드
- `state_number`: 수치를 추출하기 위한 [`StateNumSchema`](./lambda.md#stateschema와-statenumschema-필드).
- `command_update`: 값을 새로 요청하는 명령.

## 예제: 엘리베이터 층수 표시
`commax.homenet_bridge.yaml`은 `state_number`로 오프셋 2 바이트를 정수로 읽어 현재 층수를 노출합니다.【F:packages/core/config/commax.homenet_bridge.yaml†L400-L408】

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

## 작성 체크리스트
1. 데이터가 부호 있는 값이면 `signed: true`를, 소수면 `precision`을 설정합니다.
2. 바이트 직렬화 규칙이 BCD/ASCII라면 `decode`를 지정해 올바르게 파싱합니다.
3. 수집 주기가 긴 장비는 `command_update`를 별도로 두어 사용자 요청 시 값을 재요청하도록 합니다.
