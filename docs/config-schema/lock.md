# Lock 스키마 작성법

도어락·가스락 등 잠금 장치는 `lock` 엔티티를 사용합니다. `type`은 `lock`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 지정합니다.

## 필수 필드
- 최소 한 개의 상태 서명(`state` 또는 세부 상태 `state_locked`/`state_unlocked`)으로 현재 잠금 상태를 감지해야 합니다.

## 옵션 필드 (상태)
- `state`: 장치에서 오는 기본 상태 패킷 서명.
- 잠금 단계: `state_locked`, `state_unlocked`, `state_locking`, `state_unlocking`, `state_jammed` — 모두 [`StateSchema`](./lambda.md#stateschema와-statenumschema-필드) 또는 람다.

## 옵션 필드 (명령)
- `command_lock`, `command_unlock`: 잠금/해제 패킷.
- `command_update`: 상태 재요청 패킷.

## 예제: 가스 밸브 잠금 제어
`kocom_theart.homenet_bridge.yaml`에서는 상태 비트로 잠금/해제를 구분하고, `command_update`로 최신 상태를 다시 요청합니다.【F:packages/core/config/kocom_theart.homenet_bridge.yaml†L496-L540】

```yaml
lock:
  - id: gas_burner_lock
    name: "Gas Buner Lock"
    icon: mdi:gas-burner
    state:
      data: [0x30, 0xd0, 0x00, 0x2c, 0x00]
      mask: [0xff, 0xf0, 0xff, 0xff, 0xff]
    state_unlocked:
      offset: 7
      data: [0x01]
    state_locked:
      offset: 7
      data: [0x02]
    command_lock:
      data: [0x30, 0xbc, 0x00, 0x2c, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    command_update:
      data: [0x30, 0xbc, 0x00, 0x2c, 0x00, 0x01, 0x00, 0x3a, 0x00]
```

## 작성 체크리스트
1. 잠금 상태가 여러 단계(잠김/잠김 중/해제 중)를 거친다면 각각의 `state_*`를 분리해 Home Assistant 상태를 정확히 반영합니다.
2. 일부 장비는 잠금 명령 후 별도 ACK 패킷을 보내므로 `packet_defaults.rx_header/footer`와 체크섬을 맞춰야 합니다.
3. 키패드 오류 등 예외 상태를 `state_jammed`로 분리해 알림을 강화할 수 있습니다.
