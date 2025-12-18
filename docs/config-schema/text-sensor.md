# Text Sensor 스키마 작성법

엘리베이터 방향 등 문자열 상태를 노출하려면 `text_sensor` 엔티티를 사용합니다. `type`은 `text_sensor`이며 공통 필드(`id`, `name`, `packet_parameters`, `icon`)를 함께 지정합니다.

## 필수/옵션 필드
- `state`: 이 엔티티에 해당하는 패킷 서명. 생략하면 람다만으로 값을 추출할 때 사용합니다.
- `state_text`: 문자열을 추출하는 [`StateSchema`](./lambda.md#stateschema와-statenumschema-필드) 또는 CEL 표현식.

## 예제: 엘리베이터 방향 해석
`kocom_thinks.homenet_bridge.yaml`은 패킷 오프셋 8 바이트를 확인해 방향을 한글 문자열로 치환합니다.【F:packages/core/config/examples/kocom_thinks.homenet_bridge.yaml†L717-L728】

```yaml
text_sensor:
  - id: elevator_direction
    name: "Elevator Direction"
    icon: mdi:elevator
    state:
      data: [0x30, 0xd0, 0x00, 0x01, 0x00, 0x44, 0x00]
      mask: [0xff, 0xf0, 0xff, 0xff, 0xff, 0xff, 0xff]
    state_text: !lambda |-
      if (data[8] === 0x00) return "정지";
      if (data[8] === 0x01) return "하강";
      if (data[8] === 0x02) return "상승";
      if (data[8] === 0x03) return "도착";
      return "Unknown";
```

## 작성 체크리스트
1. 문자열 매핑이 단순할 경우 `valueMappings`가 포함된 [`StateLambdaConfig`](./lambda.md#statelambdaconfig)를 활용해 가독성을 높입니다.
2. 디스플레이용 내부 센서는 `internal: true`와 함께 사용해 MQTT 발표를 제한할 수 있습니다.
3. 길이가 긴 메시지를 다룰 땐 `state_text` 대신 `text` 엔티티를 검토해 입력/출력 모두 지원하도록 합니다.
