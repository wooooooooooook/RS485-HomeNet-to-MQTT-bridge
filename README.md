[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge)
[github wiki](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/wiki/%EC%8B%9C%EC%9E%91%ED%95%98%EA%B8%B0)

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
         # 타임존 (비워두면 서버는 UTC, 프론트는 브라우저 설정)
         TIMEZONE: ''
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

## 💡 고급 사용법

### 멀티 포트(Multi-port) 사용하기

- 여러 개의 RS485 포트를 사용하는 경우, `homenet2mqtt` 폴더 내에 각각의 설정 파일을 생성합니다 (예: `livingroom.yaml`, `room1.yaml`).
- 각 파일의 `serial.path`에 해당 장치 경로를 입력하고, `serial.portId`가 중복되지 않도록 설정합니다.
- 애드온 구성(또는 Docker 환경 변수)의 `CONFIG_FILES`에 파일 이름들을 쉼표로 구분하여 입력한 후 재시작합니다.

- [Config 작성법 (상세 스키마)](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/tree/main/docs/config-schema)

## ❓ 자주 묻는 질문 (Troubleshooting)

### 1. "Permission denied" 또는 시리얼 포트 열기 실패

- **증상**: Docker 컨테이너 로그에 `Error: Permission denied, cannot open /dev/ttyUSB0` 와 같은 에러가 발생합니다.
- **해결**:
  - 리눅스 호스트의 경우 사용자가 `dialout` 그룹에 포함되어 있는지 확인하세요.
  - Docker 실행 시 `--device /dev/ttyUSB0:/dev/ttyUSB0` 옵션을 정확히 사용했는지 확인하세요.
  - Synology NAS 등 일부 환경에서는 USB 드라이버 설치가 필요할 수 있습니다.

### 2. MQTT 연결 실패

- **증상**: `Connection refused` 또는 `Not authorized` 에러 발생.
- **해결**:
  - Home Assistant 애드온 사용 시: 별도의 설정 없이 자동으로 연결되지만, 실패한다면 애드온 설정에서 `username`/`password`를 확인하세요.
  - Docker 사용 시: `MQTT_URL`이 정확한지 확인하세요. (예: `mqtt://192.168.1.100:1883`). `localhost`는 컨테이너 자신을 가리키므로, 호스트 IP를 입력해야 할 수 있습니다.

### 3. 패킷이 전혀 들어오지 않음

- **증상**: 로그에 패킷 수신 기록이 없음.
- **해결**:
  - RS485 선의 A/B (또는 +, -) 극성이 바뀌지 않았는지 확인해보세요.
  - 월패드 제조사에 맞는 Serial 설정(Baud rate 등)이 맞는지 확인하세요.
  - `packet_defaults`의 `rx_header`가 정확한지 확인하세요. 설정된 헤더와 일치하지 않는 패킷은 모두 무시됩니다.

### 4. 로그 레벨 변경 및 디버깅 (Debugging)

- **설명**: 문제가 발생했을 때 상세한 로그를 확인하면 원인을 파악하기 쉽습니다.
- **방법**:
  - Docker Compose: `docker-compose.yml`에서 `LOG_LEVEL: debug`로 변경하고 컨테이너를 재시작합니다.
  - Home Assistant Add-on: 애드온의 **[구성(Configuration)]** 탭에서 `log_level`을 `debug`로 변경합니다.
  - **확인할 내용**: 로그에서 `[Raw Packet]`으로 시작하는 라인을 확인하여 패킷이 실제로 들어오는지, 깨져서 들어오는지 확인합니다.

### 5. 웹 UI 접속 불가

- **증상**: 브라우저에서 `http://IP:3000` 접속이 안 됨.
- **해결**:
  - Docker 사용 시 `ports: - "3000:3000"` 매핑이 되어 있는지 확인하세요.
  - 방화벽(UFW, 시놀로지 방화벽 등)에서 3000번 포트가 허용되어 있는지 확인하세요.
  - 브라우저의 광고 차단 확장 프로그램이 간혹 웹소켓 연결을 차단할 수 있습니다. 시크릿 모드에서 시도해보세요.

## 👨‍💻 개발 및 기여 (Development)

이 프로젝트에 기여하거나 로컬 환경에서 개발을 진행하려면 [개발 가이드 (docs/DEVELOPMENT.md)](docs/DEVELOPMENT.md)를 참고하세요.

- 로컬 개발 환경 설정 (Docker 미사용 포함)
- 프로젝트 구조 및 아키텍처
- 테스트 및 린트 실행 방법

## 문의 및 지원
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge)

[GitHub Issues](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/issues)

[Discord](https://discord.gg/kGwhUBMe5z)

## ⚖️ 라이선스

이 프로젝트는 MIT License를 따릅니다.
