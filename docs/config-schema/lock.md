# Lock 스키마 작성법

도어락처럼 잠금/해제를 제어하는 장치는 `lock` 엔티티로 정의합니다.

## 필수 필드
- `id`, `name`
- `state`: 상태 패킷 서명.
- `state_locked`, `state_unlocked`: 현재 잠금 상태 판단용 패턴.
- `command_lock`, `command_unlock`: 잠금/해제 명령 패킷.

## 옵션 필드
- `state_locking`, `state_unlocking`, `state_jammed`: 중간 상태나 오류 상태를 표현.
- `command_update`: 상태 새로고침 패킷.

## 기본 예제 (단순 잠금/해제)
`kocom_theart.homenet_bridge.yaml`에서는 현관 도어락을 1바이트 상태로 판별합니다.

```yaml
lock:
  - id: entrance_door
    name: "현관 도어락"
    state:
      data: [0xaa, 0x55, 0x70, 0x00, 0x00]
    state_locked:
      offset: 8
      data: [0x01]
    state_unlocked:
      offset: 8
      data: [0x00]
    command_lock:
      data: [0xaa, 0x70, 0x01]
    command_unlock:
      data: [0xaa, 0x70, 0x00]
```

## 고급 예제 (중간 상태 추적)
`ENTITY_EXAMPLES.md`에서 제안하는 확장 형태처럼, 추가 상태를 매핑하면 Home Assistant가 애니메이션을 표시합니다. 실제 패킷 비트에 맞춰 오프셋만 조정하세요.

```yaml
lock:
  - id: entrance_gate
    name: "출입문"
    state:
      data: [0xa1, 0x00]
    state_locked:
      offset: 1
      data: [0x01]
    state_unlocked:
      offset: 1
      data: [0x00]
    state_locking:
      offset: 1
      data: [0x02]
    state_unlocking:
      offset: 1
      data: [0x03]
    state_jammed:
      offset: 1
      data: [0xff]
    command_lock:
      data: [0xa1, 0x01]
    command_unlock:
      data: [0xa1, 0x00]
```

## 작성 체크리스트
1. 잠금 상태가 동일 패킷에서 여러 비트로 표현된다면 `mask`로 필요한 비트만 추출합니다.
2. 도어락이 ACK 패킷을 별도로 보내면 `command_*`에 응답용 `rx_match`를 추가해 통신 성공 여부를 확인합니다.
3. 실제 장치가 잠금/해제 중에 다른 값을 보내는지 캡쳐해 `state_locking`/`state_unlocking`을 넣으면 UX가 개선됩니다.
