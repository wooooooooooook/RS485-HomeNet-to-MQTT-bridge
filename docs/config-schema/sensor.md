# Sensor 스키마 작성법

전력, 온도, 습도 등 수치 데이터를 노출할 때는 `sensor` 엔티티를 사용합니다.

## 필수 필드
- `id`, `name`
- `state`: 패킷 서명.
- `state_value`: 센서 값 위치. `offset`, `length`, `precision`, `endian`을 설정합니다.

## 옵션 필드
- `device_class`, `unit_of_measurement`: Home Assistant 표현을 위한 단위/클래스.
- `icon`: 커스텀 아이콘.
- `filters`: 값 보정(`multiply`, `add`)이 필요할 때 사용.

## 기본 예제 (전력 측정)
`hyundai_imazu.homenet_bridge.yaml`에서는 실시간 전력량을 2바이트 정수로 읽습니다.

```yaml
sensor:
  - id: power_usage_w
    name: "전력 사용량"
    device_class: power
    unit_of_measurement: W
    state:
      data: [0x6f, 0x01, 0x02, 0x00, 0x00]
    state_value:
      offset: 8
      length: 2
      endian: big
```

## 필터 예제 (소수점 보정)
`ezville.homenet_bridge.yaml`에서는 일부 값이 0.1 단위로 제공되어 `precision`과 `filters`를 함께 사용합니다.

```yaml
sensor:
  - id: floor_temperature
    name: "바닥 온도"
    device_class: temperature
    unit_of_measurement: "°C"
    state:
      data: [0x0d, 0x10, 0x01, 0x00, 0x00]
    state_value:
      offset: 10
      length: 1
      precision: 1
    filters:
      - multiply: 0.5
```

## 작성 체크리스트
1. 센서 값이 부호 있는 정수인지 확인하고 필요하면 `signed: true`를 추가합니다.
2. 길이가 2바이트 이상이면 `endian`을 지정하지 않을 때 기본은 big endian임을 기억하세요.
3. 값이 비트 필드일 경우 `mask`를 사용하거나 `mapping`을 통해 텍스트 센서로 분리하는 것이 더 적절한지 검토합니다.
