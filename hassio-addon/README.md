[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/homenet2mqtt)

# Homenet2MQTT - RS485 HomeNet to MQTT Bridge

## 준비물
- RS485 USB serial 장치 또는 EW11같은 tcp-serial 변환 장치
- USB 장치의 경우 HA에 연결한 후 ha설정-시스템-하드웨어-모든하드웨어에서 tty로 검색했을때 나오는 /dev/ttyUSB0 같은 경로를 입력해주세요.
- EW11같은 TCP-Serial 변환 장치의 경우 IP주소와 포트번호를 입력해주세요. (ew11의 경우 기본값은 `ew11의아이피주소:8899` 입니다. 예: `192.168.0.123:8899`)

## 간단 사용법

1. 애드온 스토어에 저장소 추가: https://github.com/wooooooooooook/HAaddons

2. Homenet2MQTT 애드온 설치 후 실행하면 초기 설정 마법사가 표시됩니다.

3. 설정 마법사에서 월패드 종류를 선택하면 기본 설정 파일이 자동으로 생성됩니다.

4. `/homeassistant/homenet2mqtt/` 에서 생성된 설정 파일을 열어서 집에 맞게 수정하세요. 
    - 월패드 설정 파일을 ChatGPT 등에 넣고 본인 집 월패드에 등록된 디바이스들 개수를 설명해주면 AI가 작성을 도와줍니다.
    - [Config 문서](https://github.com/wooooooooooook/homenet2mqtt/tree/main/docs/config-schema)를 참고하세요.

5. 애드온의 **[구성(Configuration)]** 탭에서 MQTT 로그인 정보 및 필요한 경우 브릿지 관련 상세 설정을 변경해주세요.
   - `mqtt_url`: MQTT 브로커 주소 (HA 내장 `Mosquitto broker` 애드온 사용 시 기본값 `mqtt://core-mosquitto:1883` 유지)
   - `mqtt_need_login`: **필수** MQTT 인증 필요 여부 (`true`/`false`), 아이디 패스워드를 모른다면 `Mosquitto broker`애드온의 구성에서 아이디 비밀번호를 추가하고, 아래에 입력해주세요.
   - `mqtt_user`: MQTT 사용자 아이디, mqtt도 애드온으로 사용중이면 비워두면 자동 로그인됩니다.
   - `mqtt_passwd`: MQTT 비밀번호, mqtt도 애드온으로 사용중이면 비워두면 자동 로그인됩니다.
   - `mqtt_topic_prefix`: MQTT 토픽 접두사. 기본값은 `homenet2mqtt`이며 변경할 필요 없습니다. 최종 토픽은 `${mqtt_topic_prefix}/{portId}/{entityId}/...` 형태로 발행됩니다.
   - `timezone`: 타임존(IANA). 비워두면 서버는 UTC, 프론트는 브라우저 설정을 따릅니다. 예: `Asia/Seoul`
   - `config_files`: **비워두면 애드온 시작시 초기설정 마법사를 통해 자동으로 설정파일을 구성하여 사용하게됩니다.** 또는 직접 사용할 설정 파일 목록을 나열할 수 있습니다. 여러 개의 포트를 사용할 경우 쉼표로 구분하여 나열합니다. (예: `livingroom.yaml, room1.yaml`) 기본값(`default.homenet_bridge.yaml,`)

6. 애드온을 재시작하면 설정 파일에 등록된 엔티티들이 MQTT Discovery를 통해 Home Assistant에 자동으로 등록됩니다.
    - 주의: 상태 패킷이 수신된 엔티티만 등록됩니다.

7. 애드온의 Web UI에서 다음 기능을 사용할 수 있습니다:
    - 패킷 수신 상태 확인
    - 등록된 엔티티의 상태 모니터링
    - 명령 패킷 전송
    - 패킷 간격 분석 (명령이 씹히는 경우 패킷 간격과 겹치지 않는 딜레이 설정에 활용)

8. 사용하지 않는 비활성화된 엔티티를 모두 삭제하면 성능 개선에 도움이됩니다.


## 고급 사용법

### 멀티포트사용하기
- RS485가 여러 라인으로 구성된경우 여러개의 시리얼장치 혹은 EW11을 사용하여 여러개의 포트를 사용할 수 있습니다.
- 대시보드에서 +버튼을 눌러 멀티포트를 구성하세요

#### 직접 구성하는 방법
- homenet2mqtt 폴더에 생성된 examples 폴더의 예시 설정파일들을 복제하여 homenet2mqtt 폴더에 이동합니다. 설정파일 이름은 임의로 지어주세요.
- 각 설정파일의 serial.path에 사용할 시리얼 장치의 경로를 입력해줍니다. serial.portId로 UI및 MQTT토픽이 구분되므로 중복되지 않게 설정해주세요.
- 구성의 config_files에 복제한 설정파일 이름들을 차례대로 입력하고 애드온을 재시작 하면 됩니다.

## [Config 작성법 문서 바로가기](https://github.com/wooooooooooook/homenet2mqtt/tree/main/docs/config-schema)


## 문의 및 지원
[GitHub Issues](https://github.com/wooooooooooook/homenet2mqtt/issues)
[Discord](https://discord.gg/kGwhUBMe5z)

## 라이센스
이 프로젝트는 [MIT 라이센스](LICENSE)를 따릅니다.
