# Serial 설정 스키마 작성법

`homenet_bridge.serial`은 RS485 어댑터와의 기본 통신 파라미터를 정의합니다. 파일당 하나의 포트만 허용하며, 추가 포트가 필요하면 설정 파일을 분리해 `CONFIG_FILES`에 나열하세요.

## 필수 필드
- `portId`: 포트 식별자. MQTT 토픽 접두사의 하위 경로로도 사용됩니다.
- `path`: 시리얼 포트 경로 또는 TCP 브릿지 주소(예: `/dev/ttyUSB0` 또는 `192.168.0.83:8888`).
- `baud_rate`: 통신 속도(bps). 보통 9600/19200/38400 등.
- `data_bits`: 데이터 비트 길이. `5 | 6 | 7 | 8` 중 선택.
- `parity`: 패리티 검사 방식. `none` | `even` | `mark` | `odd` | `space`.
- `stop_bits`: 스톱 비트 개수. `1 | 1.5 | 2` 중 선택.

## 선택 필드
- `serial_idle`: 지정 시간 동안 패킷이 수신되지 않으면 연결을 재시도합니다. 기본값은 `10m`이며, `0`으로 설정하면 비활성화됩니다.

## 기본 예제 (8N1)
`commax.homenet_bridge.yaml`처럼 9600bps, 패리티 없는 8N1 조합입니다.

```yaml
homenet_bridge:
  serial:
    portId: default
    path: 192.168.0.83:8888
    baud_rate: 9600
    data_bits: 8
    parity: none
    stop_bits: 1
```

## 패리티가 필요한 장비 예제
`samsung_sds.homenet_bridge.yaml`은 짝수 패리티를 사용합니다.

```yaml
homenet_bridge:
  serial:
    portId: main
    path: 192.168.0.83:8888
    baud_rate: 9600
    data_bits: 8
    parity: even
    stop_bits: 1
```

## 작성 팁
1. 제조사 매뉴얼의 UART/RS485 설정을 그대로 입력하세요. 한 자리라도 다르면 수신 패킷 매칭이 실패합니다.
2. 같은 브랜드라도 도어락·인터폰이 다른 설정을 요구할 수 있으니, 각 프로파일을 별도 파일로 관리하세요.
3. MQTT 토픽 접두사는 환경변수 `MQTT_TOPIC_PREFIX`로만 정의하고, 설정 파일에는 시리얼·엔티티 정보만 포함합니다.
4. 여러 설정 파일을 `CONFIG_FILES`로 나열하면 파일별로 독립적인 브릿지가 기동되어 포트/엔티티 구성이 섞이지 않습니다. 하나의 포트에 대응하는 내용만 포함한 YAML로 관리하세요.
