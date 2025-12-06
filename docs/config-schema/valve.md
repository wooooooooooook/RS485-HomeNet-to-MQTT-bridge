# Valve 스키마 작성법

가스 밸브나 온수 밸브처럼 열림/닫힘을 제어하는 장치는 `valve` 엔티티로 정의합니다.

## 필수 필드
- `id`, `name`
- `state`: 상태 패킷 서명.
- `state_open`, `state_closed`: 밸브 상태 판별.
- `command_open`, `command_close`: 제어 패킷.

## 옵션 필드
- `command_stop`: 열림/닫힘 중지 명령.
- `state_opening`, `state_closing`: 진행 중 상태 표현.
- `command_update`: 상태 재요청.

## 기본 예제 (가스 밸브)
`commax.homenet_bridge.yaml`은 단일 바이트로 열림/닫힘을 구분합니다.

```yaml
valve:
  - id: gas_valve
    name: "가스 밸브"
    state:
      data: [0xf7, 0x02, 0x26, 0x00, 0x00]
    state_open:
      offset: 8
      data: [0x00]
    state_closed:
      offset: 8
      data: [0x01]
    command_open:
      data: [0xaa, 0x26, 0x00]
    command_close:
      data: [0xaa, 0x26, 0x01]
```

## 확장 예제 (업데이트/중간 상태)
`kocom.homenet_bridge.yaml`에서는 업데이트 요청과 진행 상태를 함께 정의합니다.

```yaml
valve:
  - id: gas_valve
    name: "가스 밸브"
    state:
      data: [0x30, 0xd0, 0x00, 0x5b, 0x00]
    state_open:
      offset: 8
      data: [0x00]
    state_closed:
      offset: 8
      data: [0x01]
    state_opening:
      offset: 8
      data: [0x02]
    state_closing:
      offset: 8
      data: [0x03]
    command_open:
      data: [0x30, 0xb7, 0x00, 0x5b, 0x00, 0x00]
    command_close:
      data: [0x30, 0xb7, 0x00, 0x5b, 0x00, 0x01]
    command_update:
      data: [0x30, 0xdc]
```

## 작성 체크리스트
1. 밸브가 물리적으로 움직이는 시간이 길다면 `state_opening`/`state_closing`을 설정해 사용자가 진행 상황을 알 수 있게 합니다.
2. 안전을 위해 `command_stop`이 지원되는지 확인하고, 지원한다면 별도 버튼이나 자동화에 연동하세요.
3. 가스 밸브처럼 치명적 제어인 경우 MQTT 주제를 별도로 분리하거나 인증을 강화하는 것을 권장합니다.
