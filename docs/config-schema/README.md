# 엔티티별 설정 스키마 가이드

이 디렉터리는 RS485-HomeNet-to-MQTT-bridge에서 지원하는 엔티티 타입마다 YAML 설정을 작성하는 방법을 정리합니다. 각 문서는 `packages/core/config/*.homenet_bridge.yaml`의 실제 예제를 바탕으로 필수 필드, 상태 매핑, 명령 패턴을 설명합니다.

## 문서 목록
### 공통 상위 설정
- [Serial](./serial.md)
- [Packet Defaults](./packet-defaults.md)

### 엔티티별
- [Binary Sensor](./binary-sensor.md)
- [Button](./button.md)
- [Climate](./climate.md)
- [Fan](./fan.md)
- [Light](./light.md)
- [Lock](./lock.md)
- [Sensor](./sensor.md)
- [Switch](./switch.md)
- [Text Sensor](./text-sensor.md)
- [Valve](./valve.md)

### 활용 팁
1. 기본 시리얼, 헤더/푸터, 체크섬 등 공통 설정은 상위 `homenet_bridge.packet_defaults`에서 정의하고, 엔티티 블록은 필요한 필드만 오버라이드합니다.
2. `state`는 수신 패킷 매칭, `command_*`는 송신 패킷을 정의합니다. 람다(`!lambda`)를 사용하면 다른 엔티티 상태를 참조하거나 체크섬을 동적으로 계산할 수 있습니다.
3. 예제를 그대로 복사하기보다 현장 장비 패킷 구조(오프셋, 길이, 비트마스크)를 확인한 뒤 값을 맞춰 넣으세요.
