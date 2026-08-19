# 설정 가이드

> 이 섹션에서 무엇을 해결하나요?
>
> - YAML 설정을 처음부터 작성할 때 필요한 최소 흐름을 제시합니다.
> - 공통 개념(Serial, Packet Defaults, 스키마)을 먼저 익히고 엔티티 설정으로 확장합니다.
> - 엔티티 타입별 문서를 레퍼런스로 빠르게 찾을 수 있습니다.

## 먼저 읽기 (권장 순서)

1. [최소 동작 설정](./minimal-config.md)
2. [공통 엔티티 옵션](./common-entity-options.md)
3. 필요한 [엔티티 타입 문서](#엔티티-타입-레퍼런스)

## 핵심 개념

- [Serial](./serial.md)
- [Packet Defaults](./packet-defaults.md)
- [유효 패킷 탐지 전략](./packet-validation-strategies.md)
- [State/Command 스키마 정의](./schemas.md)
- [CEL 가이드](./cel-guide.md)
- [Automation](./automation.md)
- [Integration (외부 연동 설정)](./integration.md)

## 엔티티 타입 레퍼런스

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

## 활용 팁

1. 공통 설정은 `homenet_bridge.packet_defaults`에 모으고 엔티티에서 필요한 필드만 오버라이드하세요.
2. 숫자 값은 `sensor`, 문자열 값은 `text-sensor`를 사용해야 Home Assistant 그래프와 히스토리가 정상 동작합니다.
3. 처음에는 최소 구성으로 성공한 뒤 엔티티를 한 개씩 추가하는 방식이 가장 안전합니다.
