[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge)

# Homenet2MQTT - RS485 HomeNet to MQTT Bridge

[Config 작성법](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/tree/main/docs/config-schema)

간단 사용법

1. 애드온 스토어에 저장소추가: https://github.com/wooooooooooook/HAaddons

2. Homenet2MQTT 애드온 설치 후 1회 실행 후 로그가 올라오면 바로 중지하세요.

3. /homeassistant/homenet2mqtt/ 에서 본인의 월패드 파일을 열어서 집에 맞게 수정하세요. 

    - 이 부분이 가장 난관으로 예상됩니다. 월패드 파일을 chatGPT 등에 넣고 본인 집 월패드에 등록된 디바이스들 갯수를 설명해주면 AI가 작성해주지않을까.. 싶습니다. 추후에 설명 문서작성이 완료된다면 AI에게 문서를 같이 제공해주면 더 잘 작성해줄겁니다.

4. 애드온 구성에서 `serial_ports`, `config_files`, `mqtt_topic_prefixes` 배열을 설정해주세요 (각각 최소 1개)

   - `serial_ports`: USB라면 `/dev/ttyUSB0` 형식, 소켓(EW11)이라면 `192.168.0.83:8899`처럼 `ip:포트` 값을 순서대로 입력

   - `config_files`: 3번에서 수정한 설정 파일 이름을 `serial_ports`와 동일한 순서로 나열 (예: `commax.homenet_bridge.yaml`)

   - `mqtt_topic_prefixes`: MQTT 토픽 접두사 목록. 항목이 1개면 모든 포트에 공통 적용, 2개 이상일 경우 `serial_ports`와 길이가 같아야 합니다.

5. 애드온을 재시작하면 설정파일에 등록된 엔티티들이 MQTT discovery를 통해 HA에 자동으로 등록됩니다.

    - 주의: 실제 기기가 없더라도 설정파일에 있는대로 엔티티가 등록됩니다. 꼭 설정파일을 수정해서 사용하세요.

6. 애드온의 webUI는 현재 패킷 수신상태 확인 및 등록된 엔티티의 상태, 명령패킷보내기 등의 기능이 있고 패킷간격분석이있는데, 명령이 계속 씹히는 경우에 패킷 간격과 겹치지 않는 딜레이를 설정해보시라고 넣었습니다.

​

​

알파버전의 한계점

- ~~commax와 samsung SDS 패킷에대해서만 실제패킷으로 테스트해보았고 다른기기들은 체크섬계산이 잘되는지도 불명확합니다. 모험심 강한 분들의 테스트 결과를 기다려봅니다..~~

- ~~아직 상태수신, 명령발신만 구현된 상태이기 때문에 현관문제어같이 복잡한 로직이 포함된 기능은 동작하지 않을겁니다. esphome과 환경이 달라 구현방식이 조금 달라져야할것같아 고민중에있습니다.~~
- automation을 통해 구현되었으나 테스트는 안되었습니다.

- ~~상태패킷을 통한 기기자동검색 및 등록기능은 없습니다.~~
- config에 설정된 엔티티중 상태패킷이 올라오는 엔티티만 mqtt discovery를 통해 등록됩니다.