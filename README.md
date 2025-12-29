[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge)

# RS485 HomeNet to MQTT Bridge (H2M)

> **✅ 베타 버전 (Beta)**
> 이 프로젝트는 현재 **베타 단계**입니다. 대부분의 기능이 안정적으로 작동하며, 일반적인 환경에서 사용하기 적합합니다. 다만 예상치 못한 버그가 있을 수 있으니 중요한 환경에서는 백업 후 사용하시기 바랍니다.

RS485 기반의 월패드(홈넷) 신호를 MQTT 메시지로 변환하여 Home Assistant에서 제어하고 모니터링할 수 있게 해주는 브릿지 솔루션입니다.

## 🛠️ 준비물
- **RS485 USB Serial 장치** 또는 **EW11** 같은 TCP-Serial 변환 장치
- **USB 장치**: HA에 연결한 후 `설정` > `시스템` > `하드웨어` > `모든 하드웨어`에서 `tty`로 검색했을 때 나오는 경로(예: `/dev/ttyUSB0`)를 사용합니다.
- **TCP-Serial 변환 장치(EW11 등)**: 장치의 IP 주소와 포트 번호를 사용합니다. (EW11 기본값: `아이피주소:8899`)

## 🚀 시작하기

### 1. Home Assistant 애드온 (권장)

가장 간편한 설치 방법입니다.

1. **애드온 저장소 추가**: Home Assistant의 `설정` > `애드온` > `애드온 스토어` > 우측 상단 `점 세개(...)` > `저장소`에 아래 주소를 추가합니다.
   - `https://github.com/wooooooooooook/HAaddons`
2. **H2M 애드온 설치**: 목록에서 `Homenet2MQTT`를 찾아 설치한 후 **실행**합니다.
3. **초기 설정 마법사**: 애드온 상단의 `WEB UI 열기` 버튼을 클릭하여 설정 마법사를 통해 월패드 종류를 선택합니다. 제조사 목록에서 **빈 설정파일로 시작**을 선택하면 serial 파라미터를 직접 입력할 수 있습니다.
4. **설정 파일 확인/수정**: `/homeassistant/homenet2mqtt/` 경로에 생성된 설정 파일을 우리 집 환경에 맞춰 수정합니다.
5. **상세 구성**: 애드온의 **[구성(Configuration)]** 탭에서 MQTT 로그인 정보(아이디/비밀번호 등)를 입력합니다.
6. **재시작**: 설정을 마친 후 애드온을 재시작하면 기기들이 자동으로 Home Assistant에 등록됩니다.

---

### 2. Docker / Docker Compose

직접 서버를 운영하거나 Docker 환경을 선호하는 경우입니다.

1. docker compose 파일을 작성합니다.
    ```docker-compose.yml
    services:
    homenet2mqtt:
        image: nubiz/homenet2mqtt:latest
        container_name: homenet2mqtt
        environment:
        # 설정 파일 목록 (쉼표로 구분)
        CONFIG_FILES: default.homenet_bridge.yaml,
        # MQTT 브로커 URL
        MQTT_URL: mqtt://localhost:1883
        # 웹 UI 포트
        PORT: '3000'
        # 로그 레벨 (debug, info, warn, error)
        LOG_LEVEL: info
        # MQTT 인증 설정
        MQTT_NEED_LOGIN: 'false'
        MQTT_USER: ''
        MQTT_PASSWD: ''
        MQTT_TOPIC_PREFIX: homenet2mqtt
        volumes:
        # 설정 파일 볼륨
        - ./h2m-config:/config
        # 시리얼 포트 장치 (필요한 경우 주석 해제)
        # devices:
        #   - /dev/ttyUSB0:/dev/ttyUSB0
        ports:
        - '3000:3000'
        restart: unless-stopped
    ```

2. 아래 명령어로 서비스를 시작합니다.
   ```bash
   docker-compose up -d
   ```
3. `http://서버IP:3000` 접속 후 설정 마법사를 통해 설정을 완료합니다. 필요하면 **빈 설정파일로 시작**을 선택해 serial 항목을 직접 입력할 수 있습니다.
4. 설정 파일은 `./h2m-config` 디렉토리에 저장됩니다.

## 🛠️ 주요 기능
- **Web UI 기반 설정**: 복잡한 설정 없이 브라우저에서 마법사를 통해 간편하게 설정 가능.
- **Home Assistant 자동 발견**: 설정 완료 시 HA에 기기들이 자동으로 등록됩니다.
- **다양한 프로토콜 지원**: Commax, Kocom 등 국내 주요 월패드 프로토콜 지원 및 확장 가능.
- **실시간 모니터링**: Web UI를 통해 RS485 패킷의 흐름을 실시간으로 확인 가능.
- **자동화/스크립트 관리**: 대시보드에서 자동화·스크립트를 확인하고 즉시 실행하거나 활성/비활성, 삭제 및 YAML 편집을 지원.
- **안정적인 패킷 파싱**: 워커 스레드 기반 파싱과 지연 시 버퍼링/폴백으로 메인 스레드 안정성을 확보.

## 💡 고급 사용법

### 멀티 포트(Multi-port) 사용하기
- 여러 개의 RS485 포트를 사용하는 경우, `homenet2mqtt` 폴더 내에 각각의 설정 파일을 생성합니다 (예: `livingroom.yaml`, `room1.yaml`).
- 각 파일의 `serial.path`에 해당 장치 경로를 입력하고, `serial.portId`가 중복되지 않도록 설정합니다.
- 애드온 구성(또는 Docker 환경 변수)의 `CONFIG_FILES`에 파일 이름들을 쉼표로 구분하여 입력한 후 재시작합니다.

- [Config 작성법 (상세 스키마)](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/tree/main/docs/config-schema)
- [Home Assistant 연동 및 Discovery 설정](docs/config-schema/common-entity-options.md#home-assistant-연동-설정)
- [기기별 설정 예시](docs/ENTITY_EXAMPLES.md)
- [CEL (Common Expression Language) 가이드](docs/CEL_GUIDE.md)

## ⚖️ 라이선스
이 프로젝트는 MIT License를 따릅니다.
