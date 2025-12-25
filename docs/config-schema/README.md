# 엔티티별 설정 스키마 가이드

이 디렉터리는 RS485-HomeNet-to-MQTT-bridge에서 지원하는 엔티티 타입마다 YAML 설정을 작성하는 방법을 정리합니다. 각 문서는 `packages/core/config/*.homenet_bridge.yaml`의 실제 예제를 바탕으로 필수 필드, 상태 매핑, 명령 패턴을 설명합니다.

## 문서 목록
### 공통 상위 설정
- [Serial](./serial.md)
- [Packet Defaults](./packet-defaults.md)
- [공통 엔티티 옵션](./common-entity-options.md)
- [State/Command 스키마 정의](./schemas.md)
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
3. `state*`/`command*` 필드는 [State/Command 스키마 정의](./schemas.md)에 따라 작성하거나 CEL 표현식으로 대체합니다. CEL로 체크섬을 계산하거나 조건부 패킷을 생성할 수 있습니다.
4. 예제를 그대로 복사하기보다 현장 장비 패킷 구조(오프셋, 길이, 비트마스크)를 확인한 뒤 값을 맞춰 넣으세요.
5. **수치 vs 텍스트**: 온도, 전력량, 층수 등 **숫자 데이터**는 [`sensor`](./sensor.md)를 사용하고, 엘리베이터 방향(`상승`, `정지`) 등 **문자열 데이터**는 [`text-sensor`](./text-sensor.md)를 사용하세요.
   - 숫자 데이터에 `text-sensor`를 사용하면 Home Assistant에서 그래프(기록)가 정상적으로 표시되지 않습니다.
