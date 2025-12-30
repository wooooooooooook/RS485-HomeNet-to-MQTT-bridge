# Docker 배포 가이드

Docker Hub의 `nubiz/homenet2mqtt` 이미지를 사용하여 빌드 없이 바로 배포할 수 있습니다.

## 빠른 시작

1. 아래 `docker-compose.yml`을 원하는 디렉토리에 저장합니다.
2. `./h2m-config` 폴더를 생성하고 설정 파일을 넣습니다.
3. `docker compose up -d` 실행

```yaml
services:
  homenet2mqtt:
    image: nubiz/homenet2mqtt:latest
    container_name: homenet2mqtt
    environment:
      CONFIG_FILES: default.homenet_bridge.yaml,
      MQTT_URL: mqtt://localhost:1883
      PORT: '3000'
      LOG_LEVEL: info
      MQTT_NEED_LOGIN: 'false'
      MQTT_USER: ''
      MQTT_PASSWD: ''
      MQTT_TOPIC_PREFIX: homenet2mqtt
    volumes:
      - ./h2m-config:/config
      # - /dev/ttyUSB0:/dev/ttyUSB0  # 시리얼 포트
    ports:
      - '3000:3000'
    restart: unless-stopped
    # privileged: true  # 시리얼 포트 사용 시
```

## 초기화 절차

1. **최초 실행**: 컨테이너가 처음 시작되면 `./h2m-config` 폴더에 기본 설정 파일과 예제 파일이 자동으로 복사됩니다.
   - `default.homenet_bridge.yaml` - 기본 설정 파일
   - `examples/` - 예제 설정 파일들 (kocom, commax 등)
2. **설정 편집**: `./h2m-config` 폴더의 설정 파일을 사용자 환경에 맞게 수정합니다.
3. **재시작**: `docker compose restart`로 새로운 설정을 적용합니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CONFIG_FILES` | `default.homenet_bridge.yaml,` | 설정 파일 목록 (쉼표로 구분) |
| `CONFIG_ROOT` | `/config` | 설정 파일 경로 |
| `MQTT_URL` | `mqtt://localhost:1883` | MQTT 브로커 URL |
| `MQTT_NEED_LOGIN` | `false` | MQTT 인증 사용 여부 |
| `MQTT_USER` | (빈 값) | MQTT 사용자명 |
| `MQTT_PASSWD` | (빈 값) | MQTT 비밀번호 |
| `MQTT_TOPIC_PREFIX` | `homenet2mqtt` | MQTT 토픽 접두사 |
| `LOG_LEVEL` | `info` | 로그 레벨 |
| `PORT` | `3000` | 웹 UI 포트 |

## 시리얼 포트 사용

RS485 어댑터 사용 시:

```yaml
volumes:
  - /dev/ttyUSB0:/dev/ttyUSB0
privileged: true
```

## 참고

- 웹 UI: `http://<HOST>:3000`
- 예제 설정: `./h2m-config/examples/`
