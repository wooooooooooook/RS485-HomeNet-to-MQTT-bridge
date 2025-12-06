# Switch 스키마 작성법

전원이나 모드 토글처럼 단순 On/Off 제어는 `switch` 엔티티로 정의합니다.

## 필수 필드
- `id`, `name`
- `state`: 상태 패킷 서명.
- `state_on`, `state_off`: 전원 상태 판단용 패턴.
- `command_on`, `command_off`: 제어 패킷.

## 옵션 필드
- `icon`, `device_class`: UI 표시용 설정.
- `state_delay`: 중복 이벤트 필터링.
- `packet_defaults`: 특정 스위치의 헤더/체크섬 오버라이드.

## 기본 예제 (콘센트 스위치)
`hyundai_imazu.homenet_bridge.yaml`에서는 콘센트 스위치를 아래와 같이 정의합니다.

```yaml
switch:
  - id: outlet_1
    name: "콘센트 1"
    icon: mdi:power-socket
    state:
      data: [0x6f, 0x01, 0x01, 0x00, 0x00]
    state_on:
      offset: 8
      data: [0x01]
    state_off:
      offset: 8
      data: [0x00]
    command_on:
      data: [0x6f, 0x81, 0x01, 0x01]
    command_off:
      data: [0x6f, 0x81, 0x01, 0x00]
```

## 고급 예제 (도어폰 호출 제어)
`hyundai_door.homenet_bridge.yaml`에서는 도어폰 호출을 스위치로 표현하고, `state_delay`로 중복 호출을 줄입니다.

```yaml
switch:
  - id: lobby_call
    name: "공동현관 호출"
    state:
      data: [0x7f, 0x00, 0x00, 0x00, 0x00]
    state_on:
      offset: 1
      data: [0x01]
    state_off:
      offset: 1
      data: [0x00]
    state_delay: 3s
    command_on:
      data: [0x7f, 0x81, 0x01]
    command_off:
      data: [0x7f, 0x81, 0x00]
```

## 작성 체크리스트
1. 스위치 상태가 `mask`를 필요로 하는 경우가 많으니 패킷 덤프를 보고 필요한 비트만 잡아냅니다.
2. 스위치가 순간동작(예: 리모컨 호출)이라면 `state_delay`를 짧게 두어 튀는 값을 방지합니다.
3. 동일한 `state` 서명을 공유하는 여러 스위치가 있으면 `data` 내 장치 인덱스(예: `0x01`, `0x02`)를 주석으로 관리하세요.
