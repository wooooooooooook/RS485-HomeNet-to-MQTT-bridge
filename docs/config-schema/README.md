# 엔티티별 설정 스키마 가이드

이 디렉터리는 RS485-HomeNet-to-MQTT-bridge에서 지원하는 엔티티 타입마다 YAML 설정을 작성하는 방법을 정리합니다. 각 문서는 `packages/core/config/*.homenet_bridge.yaml`의 실제 예제를 바탕으로 필수 필드, 상태 매핑, 명령 패턴을 설명합니다.

## 문서 목록
### 공통 상위 설정
- [Serial](./serial.md)
- [Packet Defaults](./packet-defaults.md)
- [Common Entity Options](./common-entity-options.md)
- [CEL 가이드](../CEL_GUIDE.md)
- [Automation](../AUTOMATION.md)

### 엔티티별
- [Binary Sensor](./binary-sensor.md)
- [Button](./button.md)
- [Climate](./climate.md)
- [Fan](./fan.md)
- [Light](./light.md)
- [Lock](./lock.md)
- [Number](./number.md)
- [Select](./select.md)
- [Sensor](./sensor.md)
- [Switch](./switch.md)
- [Text](./text.md)
- [Text Sensor](./text-sensor.md)
- [Valve](./valve.md)

### 활용 팁
1. 기본 시리얼, 헤더/푸터, 체크섬 등 공통 설정은 상위 `homenet_bridge.packet_defaults`에서 정의하고, 엔티티 블록은 필요한 필드만 오버라이드합니다.
2. [모든 엔티티 공통 필드](./common-entity-options.md): `id`, `name`, `discovery_always`, `packet_parameters` 등 모든 엔티티 타입에서 공통으로 사용할 수 있는 설정에 대한 자세한 설명입니다.
3. `state*` 필드는 수신 패킷 매칭/추출용 [`StateSchema`](./lambda.md#stateschema와-statenumschema-필드) 또는 CEL 표현식를 사용하고, `command*` 필드는 송신 패킷을 정의하는 [`CommandSchema`](./lambda.md#commandschema-필드) 또는 CEL 표현식입니다. CEL로 체크섬을 동적으로 계산할 수 있습니다.
4. 예제를 그대로 복사하기보다 현장 장비 패킷 구조(오프셋, 길이, 비트마스크)를 확인한 뒤 값을 맞춰 넣으세요.
