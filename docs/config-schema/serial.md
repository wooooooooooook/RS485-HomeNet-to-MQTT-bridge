# Serial 설정 스키마 작성법

`homenet_bridge.serial` 블록은 RS485 어댑터와의 기본 통신 파라미터를 정의합니다. 모든 엔티티 설정 전에 1회만 선언하며, 실제 장비 사양과 동일해야 합니다.

## 필수 필드
- `baud_rate`: 통신 속도(bps). 보통 9600/19200/38400 등.
- `data_bits`: 데이터 비트 길이. `5 | 6 | 7 | 8` 중 선택.
- `parity`: 패리티 검사 방식. `none` | `even` | `mark` | `odd` | `space`.
- `stop_bits`: 스톱 비트 개수. `1 | 1.5 | 2` 중 선택.

## 기본 예제 (8N1)
`cvnet.homenet_bridge.yaml`처럼 9600bps, 패리티 없는 8N1 조합입니다.

```yaml
homenet_bridge:
  serial:
    baud_rate: 9600
    data_bits: 8
    parity: NONE
    stop_bits: 1
```

## 패리티가 필요한 장비 예제
`samsung_sds.homenet_bridge.yaml`은 짝수 패리티를 사용합니다. 기기 스펙에 맞춰 값만 교체하면 됩니다.

```yaml
homenet_bridge:
  serial:
    baud_rate: 9600
    data_bits: 8
    parity: EVEN
    stop_bits: 1
```

## 작성 팁
1. 제조사 매뉴얼의 UART/RS485 설정을 그대로 입력하세요. 한 자리라도 다르면 수신 패킷 매칭이 실패합니다.
2. 같은 브랜드라도 도어락·인터폰이 다른 설정을 요구할 수 있으니, 각 프로파일을 별도 파일로 관리하세요.
3. 포트 경로는 실행 시 환경 변수(`SERIAL_PORTS` 또는 호환 키 `SERIAL_PORT`)로 주입합니다. `serials` 배열 순서와 동일하게 쉼표로 나열해야 하며, 포트 수가 맞지 않으면 서비스가 즉시 실패합니다.
4. MQTT 토픽은 `{MQTT_COMMON_PREFIX}/{포트별 프리픽스}/{엔티티ID}` 구조로 발행됩니다. `MQTT_TOPIC_PREFIXES`로 포트별 프리픽스를 `serials` 순서대로 1:1 매핑할 수 있으며, 값을 생략하면 `homedevice1`, `homedevice2`처럼 자동 부여됩니다.
