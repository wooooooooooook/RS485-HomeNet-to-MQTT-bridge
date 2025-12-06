# Valve 스키마 작성법

가스 밸브 등 개폐 밸브는 `valve` 엔티티로 정의합니다. `type`은 `valve`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 사용할 수 있습니다.

## 필수 필드
- `state`: 밸브 상태를 식별하는 기본 패킷 서명.

## 옵션 필드 (상태)
- 상태 비트: `state_open`, `state_closed`, `state_opening`, `state_closing` — [`StateSchema`](./lambda.md#stateschema와-statenumschema-필드) 또는 람다.
- 위치(0~100): `state_position` — `StateNumSchema`로 현재 열림 정도를 표현.
- `reports_position`: 장치가 이동 중 위치를 주기적으로 보고하는지 여부(Boolean).

## 옵션 필드 (명령)
- 개폐 제어: `command_open`, `command_close`, `command_stop`.
- 위치 제어: `command_position` — 입력 퍼센트 값을 바이트에 삽입.
- 상태 재요청: `command_update`.

## 예제: 가스 밸브 닫기 명령
`cvnet.homenet_bridge.yaml`에서는 `state_open/closed`로 상태를 구분하고, 닫기 명령을 전송합니다.【F:packages/core/config/cvnet.homenet_bridge.yaml†L110-L123】

```yaml
valve:
  - id: gas_valve
    name: "Gas Valve"
    device_class: gas
    state:
      data: [0x20, 0x01, 0x11]
    state_closed:
      offset: 4
      data: [0x00]
    state_open:
      offset: 4
      data: [0x01]
    command_close:
      data: [0x20, 0x11, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
```

## 작성 체크리스트
1. 위치 보고가 없는 장치는 `reports_position: false`로 두고 `state_open/closed`만 채워 단순 제어로 유지합니다.
2. 이동 중 패킷이 별도로 오면 `state_opening/closing`을 사용해 UI 표시를 정확히 합니다.
3. 안전을 위해 닫기 명령 후 `command_update`를 호출하거나 ACK를 확인하는 람다를 추가하는 것이 좋습니다.
