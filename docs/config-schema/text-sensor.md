# Text Sensor 스키마 작성법

문자열 데이터(예: 도어폰 메시지, 상태 코드)를 전송할 때는 `text_sensor` 엔티티를 사용합니다.

## 필수 필드
- `id`, `name`
- `state`: 패킷 서명.
- `state_text`: 문자열을 읽을 위치. `offset`과 `length` 지정.

## 옵션 필드
- `encoding`: 기본 UTF-8 외 다른 인코딩이 필요할 때 설정.
- `filters`: 문자열 치환(`replace`) 등에 사용.

## 기본 예제 (문자 센서)
`samsung_sds_door.homenet_bridge.yaml`에서는 도어폰 상태 문자열을 그대로 노출합니다.

```yaml
text_sensor:
  - id: door_status
    name: "도어폰 상태"
    state:
      data: [0x7f, 0x00, 0x00, 0x00]
    state_text:
      offset: 4
      length: 8
```

## 매핑 예제 (상태 코드 → 문자열)
`kocom_thinks.homenet_bridge.yaml`처럼 코드값을 사람이 읽기 쉬운 텍스트로 변환하려면 `mapping`을 사용합니다.

```yaml
text_sensor:
  - id: valve_state_text
    name: "밸브 상태 텍스트"
    state:
      data: [0x30, 0xd0, 0x00, 0x5b, 0x00]
    state_text:
      offset: 8
      mapping:
        0x00: "닫힘"
        0x01: "열림"
        0x02: "오류"
```

## 작성 체크리스트
1. 텍스트 길이가 가변이면 `length` 대신 `until` 옵션으로 종료 바이트(예: `0x00`)를 지정합니다.
2. 장치가 EUC-KR 등 다른 인코딩을 사용하면 `encoding`을 맞춰야 글자가 깨지지 않습니다.
3. 숫자 코드를 문자열로 바꿀 수 있다면 `mapping`이 더 간결하며, Home Assistant 자동화에서도 편리합니다.
