# Button 스키마 작성법

버튼은 MQTT를 통해 단발성 명령을 전송할 때 사용합니다. 패킷을 그대로 보내거나 람다로 가공할 수 있습니다.

## 필수 필드
- `id`, `name`: 엔티티 식별자와 표시 이름.
- `command_press`: 버튼을 눌렀을 때 송신할 패킷 정의. 고정 배열 또는 `!lambda`로 작성합니다.

## 옵션 필드
- `icon`: UI용 아이콘 이름.
- `device_class`: Home Assistant 버튼 클래스(`restart`, `identify` 등).
- `packet_defaults` 오버라이드: 특정 버튼만 다른 헤더/푸터/체크섬을 사용할 때 중첩 설정을 덮어쓸 수 있습니다.

## 기본 예제 (가스 밸브 닫기)
`samsung_sds.homenet_bridge.yaml`은 가스 밸브 차단 버튼을 아래처럼 정의합니다. `command_press`에 즉시 전송할 바이트 시퀀스를 적습니다.

```yaml
button:
  - id: gas_valve_close
    name: "가스 차단"
    icon: mdi:valve
    command_press:
      data: [0x20, 0x01, 0x00, 0x01, 0x00]
```

## 람다 예제 (체크섬 포함 명령)
체크섬이 필요하거나 이전 상태를 참고해야 한다면 `!lambda`를 사용합니다. `kocom.homenet_bridge.yaml`에서는 조명 상태 갱신을 위해 두 개의 패킷을 연속 전송합니다.

```yaml
button:
  - id: update_all
    name: "상태 새로고침"
    command_press: !lambda |-
      return [
        [0x30, 0xbc, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0],
        [0x30, 0xdc]
      ];
```

## 작성 체크리스트
1. 버튼은 상태를 가지지 않으므로 별도의 `state` 블록이 없습니다.
2. 여러 패킷을 연속 전송해야 할 때는 배열 안에 배열로 나열합니다.
3. 람다 내부에서 `getEntityState`를 활용하면 다른 엔티티의 현재 상태를 읽어 복합 명령을 만들 수 있습니다.
