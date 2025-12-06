# Packet Defaults 스키마 작성법

`homenet_bridge.packet_defaults`는 모든 엔티티가 공통으로 사용하는 패킷 프레임 규칙과 시간 제어 값을 정의합니다. 헤더/푸터, 체크섬, 타임아웃을 한 번에 지정해 중복을 줄이고, 개별 엔티티 블록에서 필요할 때만 오버라이드합니다.

## 필드 목록
- `rx_header` / `tx_header`: 수신·송신 패킷 앞부분 식별 바이트 배열.
- `rx_footer` / `tx_footer`: 패킷 종료 시그널.
- `rx_checksum` / `tx_checksum`: 기본 체크섬 계산기. `add`, `xor`, `add_no_header`, `samsung_rx` 등 문자열 또는 `!lambda`/커스텀 알고리즘 객체.
- `rx_checksum2` / `tx_checksum2`: 이중 체크섬(`xor_add` 혹은 `!lambda`).
- `rx_length`: 고정 길이 패킷일 때 전체 길이를 명시.
- `tx_delay`: 연속 송신 시 두 패킷 사이의 지연.
- `tx_retry_cnt`: 재전송 횟수.
- `tx_timeout`: 명령 패킷 송신 완료 대기 시간.
- `rx_timeout`: 상태 패킷 수신 대기 시간.

## 기본 예제 (양방향 동일 헤더/푸터)
`kocom.homenet_bridge.yaml`은 동일한 헤더·푸터와 단순 합산 체크섬을 사용합니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_timeout: 10ms
    tx_delay: 50ms
    tx_timeout: 500ms
    tx_retry_cnt: 3
    rx_header: [0xAA, 0x55]
    rx_footer: [0x0D, 0x0D]
    tx_header: [0xAA, 0x55]
    tx_footer: [0x0D, 0x0D]
    rx_checksum: add_no_header
    tx_checksum: add_no_header
```

## 방향별 헤더/체크섬이 다른 예제
`cvnet.homenet_bridge.yaml`처럼 수신·송신 헤더가 같더라도 푸터와 체크섬 로직이 다를 수 있습니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_header: [0xF7]
    rx_footer: [0xAA]
    rx_checksum: add_no_header
    tx_header: [0xF7]
    tx_footer: [0xAA]
    tx_checksum: add_no_header
```

## 이중 체크섬 예제
`ezville.homenet_bridge.yaml`은 XOR+합산 방식의 보조 체크섬을 사용합니다. 기본 체크섬이 없을 때 `rx_checksum`를 생략하고 `rx_checksum2`만 둘 수도 있습니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_header: [0xF7]
    tx_header: [0xF7]
    rx_checksum2: xor_add
    tx_checksum2: xor_add
```

## 브랜드별 커스텀 계산기 예제
`samsung_sds.homenet_bridge.yaml`은 전용 체크섬 함수를 사용합니다. 이름만 바꾸면 다른 엔티티가 자동으로 상속합니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_header: [0xB0]
    rx_checksum: samsung_rx
    tx_checksum: samsung_tx
```

## 작성 팁
1. 헤더/푸터와 체크섬 계산 규칙을 모르면 우선 패킷 캡처를 진행한 뒤, 동일한 구간을 `state.data`로 맞춰 넣으세요.
2. 엔티티마다 특이 규칙이 있을 경우 해당 엔티티 블록 안에 `packet_defaults`를 중첩해 일부 값만 덮어쓰면 됩니다.
3. 타임아웃과 지연은 장비 응답 속도에 맞춰 조정하되, 과도하게 짧으면 재전송이 반복되고 길면 UI 반응이 느려집니다.
