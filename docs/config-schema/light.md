# Light 스키마 작성법

조명 스위치는 `light` 엔티티로 정의하며, 켜짐/꺼짐 상태와 명령 패킷을 지정합니다. 다채널 조명은 한 패킷에서 여러 비트를 읽거나, 람다 명령으로 다른 채널 상태를 참조할 수 있습니다.

## 필수 필드
- `id`, `name`
- `state`: 상태 패킷 서명. `data`와 `mask`로 채널 구분.
- `state_on`, `state_off`: 전원 상태 판단용 오프셋/데이터.
- `command_on`, `command_off`: 전송 패킷. 고정 배열 또는 `!lambda`.

## 옵션 필드
- `command_update`: 상태 재요청 패킷.
- `packet_defaults`: 특정 조명만 다른 헤더/체크섬을 사용할 때 덮어쓰기.

## 기본 예제 (단일 채널)
`cvnet.homenet_bridge.yaml`은 각 조명을 별도 패킷으로 제어합니다. `state_on/off`는 동일 오프셋에서 비트만 바뀝니다.

```yaml
light:
  - id: living_light_1
    name: "거실 메인등"
    state:
      data: [0xf7, 0x02, 0x25, 0x00, 0x00]
    state_on:
      offset: 8
      data: [0x10]
    state_off:
      offset: 8
      data: [0x00]
    command_on:
      data: [0xaa, 0x25, 0x10]
    command_off:
      data: [0xaa, 0x25, 0x00]
```

## 고급 예제 (상호 참조 람다)
`kocom.homenet_bridge.yaml`에서는 두 개의 조명을 한 패킷에서 제어합니다. 람다에서 다른 채널 상태를 읽어 함께 전송해 일관성을 유지합니다.

```yaml
light:
  - id: room_0_light_1
    name: "Room 0 Light 1"
    state:
      data: [0x30, 0xd0, 0x00, 0x0e, 0x00]
      mask: [0xff, 0xf0, 0xff, 0xff, 0xff]
    state_on:
      offset: 8
      data: [0xff]
    state_off:
      offset: 8
      data: [0x00]
    command_on: !lambda |-
      const light2 = getEntityState('room_0_light_2');
      const light2_on = light2 && light2.is_on ? 0xff : 0x00;
      return [[0x30, 0xbc, 0x00, 0x0e, 0x00, 0x01, 0x00, 0x00, 0xff, light2_on, 0, 0, 0, 0, 0, 0], [0x30, 0xdc]];
    command_off: !lambda |-
      const light2 = getEntityState('room_0_light_2');
      const light2_on = light2 && light2.is_on ? 0xff : 0x00;
      return [[0x30, 0xbc, 0x00, 0x0e, 0x00, 0x01, 0x00, 0x00, 0x00, light2_on, 0, 0, 0, 0, 0, 0], [0x30, 0xdc]];
```

## 작성 체크리스트
1. 다채널 장비는 `mask`로 채널 비트를 고정한 뒤 `offset`만 변경해 재사용합니다.
2. 조명 그룹을 동시에 전송해야 하면 `command_on/off` 안에 여러 패킷 배열을 반환하거나, 람다에서 다른 엔티티 상태를 읽어 일관성을 맞춥니다.
3. 상태 패킷 길이가 길 경우 오프셋을 헷갈리기 쉬우니 주석으로 바이트 인덱스를 명시합니다.
