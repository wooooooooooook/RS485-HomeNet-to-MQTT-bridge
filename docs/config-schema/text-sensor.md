# Text Sensor 스키마 작성법

엘리베이터 방향, 현재 상태 메시지 등 **문자열** 상태를 노출하려면 `text_sensor` 엔티티를 사용합니다. `type`은 `text_sensor`이며 공통 필드(`id`, `name`, `packet_parameters`, `icon`)를 함께 지정할 수 있습니다.

> 💡 **수치값**(온도, 전력, 층수 등)을 표시하려면 [`sensor`](./sensor.md)를 사용하세요.

## 필수 필드
- `state`: 이 텍스트 상태가 포함된 패킷을 식별하는 서명.
- `state_text`: 문자열을 추출하는 방법 (CEL 표현식 또는 스키마).
  - **CEL (추천)**: `data[8] == 1 ? "상승" : "하강"` 과 같이 로직으로 문자열 반환.
  - **스키마**: [`StateSchema`](./schemas.md#stateschema)를 사용하여 특정 위치의 ASCII 문자를 읽음.

## 예제 1: 스키마 기반 (ASCII 추출)
패킷의 특정 오프셋에서 ASCII 문자열을 직접 읽어옵니다.
```yaml
text_sensor:
  - id: elevator_status_msg
    name: "엘리베이터 메시지"
    state:
      data: [0x30, 0xd0]
    state_text:
      offset: 8
      length: 4
```

## 예제 2: CEL 표현식 (상태 매핑)
`kocom_thinks.homenet_bridge.yaml`은 패킷 오프셋 8 바이트를 확인해 방향을 한글 문자열로 치환합니다.

```yaml
text_sensor:
  - id: elevator_direction
    name: "Elevator Direction"
    icon: mdi:elevator
    state:
      data: [0x30, 0xd0, 0x00, 0x01, 0x00, 0x44, 0x00]
      mask: [0xff, 0xf0, 0xff, 0xff, 0xff, 0xff, 0xff]
    state_text: >-
      data[8] == 0x00 ? "정지" :
      (data[8] == 0x01 ? "하강" :
      (data[8] == 0x02 ? "상승" :
      (data[8] == 0x03 ? "도착" : "Unknown")))
```

## 작성 체크리스트
1. 문자열 매핑이 필요한 경우 CEL 표현식을 사용하는 것이 가장 유연합니다.
2. 패킷에서 직접 텍스트를 읽을 때는 `offset`과 `length`가 정확한지 확인하세요.
3. 디스플레이용 내부 센서는 `internal: true`와 함께 사용해 MQTT 발표를 제한할 수 있습니다.
4. 길이가 긴 메시지를 다룰 땐 `state_text` 대신 `text` 엔티티를 검토해 입력/출력 모두 지원하도록 합니다.
