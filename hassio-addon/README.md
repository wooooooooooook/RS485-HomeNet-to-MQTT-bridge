[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge)

# Homenet2MQTT - RS485 HomeNet to MQTT Bridge

> **⚠️ 주의: 알파 버전**
> 이 프로젝트는 현재 **초기 개발 단계(Alpha)**입니다. 소프트웨어가 불안정할 수 있으며, 잦은 업데이트와 **하위 호환성을 깨는 변경(Breaking Changes)**이 예고 없이 발생할 수 있습니다. 운영 환경 적용 시 주의하시기 바랍니다.

[Config 작성법](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/tree/main/docs/config-schema)

간단 사용법

1. 애드온 스토어에 저장소추가: https://github.com/wooooooooooook/HAaddons

2. Homenet2MQTT 애드온 설치 후 1회 실행 후 로그가 올라오면 바로 중지하세요.

3. /homeassistant/homenet2mqtt/ 에서 본인의 월패드 파일을 열어서 집에 맞게 수정하세요. 

    - 이 부분이 가장 난관으로 예상됩니다. 월패드 파일을 chatGPT 등에 넣고 본인 집 월패드에 등록된 디바이스들 갯수를 설명해주면 AI가 작성해주지않을까.. 싶습니다. 추후에 설명 문서작성이 완료된다면 AI에게 문서를 같이 제공해주면 더 잘 작성해줄겁니다.

4. 애드온 구성에서 `config_files` 배열과 `mqtt_topic_prefix`를 설정해주세요 (`config_file`는 하위 호환)

   - `config_files`: 3번에서 수정한 설정 파일 이름을 나열합니다. 파일마다 단일 포트 구성을 담고 있으며, 항목별로 별도 브릿지가 뜹니다.

   - `mqtt_topic_prefix`: MQTT 토픽 접두사. 기본값은 `homenet2mqtt`이며 최종 토픽은 `${mqtt_topic_prefix}/{portId}/{entityId}/...` 형태로 발행됩니다.

5. 애드온을 재시작하면 설정파일에 등록된 엔티티들이 MQTT discovery를 통해 HA에 자동으로 등록됩니다.

    - 주의: 실제 기기가 없더라도 설정파일에 있는대로 엔티티가 등록됩니다. 꼭 설정파일을 수정해서 사용하세요.

6. 애드온의 webUI는 현재 패킷 수신상태 확인 및 등록된 엔티티의 상태, 명령패킷보내기 등의 기능이 있고 패킷간격분석이있는데, 명령이 계속 씹히는 경우에 패킷 간격과 겹치지 않는 딜레이를 설정해보시라고 넣었습니다.

## 초기화 및 기본 설정 파일
- 기본 번들 설정 파일은 `packages/core/config/commax.homenet_bridge.yaml`이며 추가 예제는 `packages/core/config/examples/`에 있습니다.
- `/homeassistant/homenet2mqtt`에 `default.homenet_bridge.yaml` 또는 `default.yaml`이 없고 `.initialized` 파일도 없으면 `/api/config/examples`에서 예제 목록을 내려주며, 선택한 항목이 `default.homenet_bridge.yaml`으로 복사된 뒤 `.initialized`/`.restart-required`가 생성됩니다. 서버 프로세스는 종료되고 애드온 루프가 이를 감지해 자동 재시작합니다.

| 상황 | 설정 파일 우선순위 |
| --- | --- |
| 최초 기동 (`.initialized` 없음) | 1) `/homeassistant/homenet2mqtt/default.homenet_bridge.yaml` → 2) `config_files`/`config_file` 옵션 → 3) `/homeassistant/homenet2mqtt` 내 기타 `*.homenet_bridge.yaml` |
| 이후 기동 (`.initialized` 존재) | 1) `config_files`/`config_file` 옵션 → 2) `/homeassistant/homenet2mqtt` 내 모든 `*.homenet_bridge.yaml`(기본/레거시 포함) |

                                                                                                                                ​

                                                                                                                                ​

알파버전의 한계점

- ~~commax와 samsung SDS 패킷에대해서만 실제패킷으로 테스트해보았고 다른기기들은 체크섬계산이 잘되는지도 불명확합니다. 모험심 강한 분들의 테스트 결과를 기다려봅니다..~~

- ~~아직 상태수신, 명령발신만 구현된 상태이기 때문에 현관문제어같이 복잡한 로직이 포함된 기능은 동작하지 않을겁니다. esphome과 환경이 달라 구현방식이 조금 달라져야할것같아 고민중에있습니다.~~
- automation을 통해 구현되었으나 테스트는 안되었습니다.

- ~~상태패킷을 통한 기기자동검색 및 등록기능은 없습니다.~~
- config에 설정된 엔티티중 상태패킷이 올라오는 엔티티만 mqtt discovery를 통해 등록됩니다.