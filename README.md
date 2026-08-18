[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/wooooooooooook/homenet2mqtt)

# h2m (RS485 HomeNet to MQTT/Matter Bridge)

RS485 기반 월패드(홈넷) 신호를 MQTT(Homenet2MQTT / h2m-mqtt) 또는 Matter(Homenet2Matter / h2m-matter) 표준으로 변환해 홈어시스턴트, 애플 홈, 삼성 스마트싱스, 구글 홈 등 다양한 스마트홈 플랫폼에서 일괄적으로 제어/모니터링할 수 있도록 도와주는 통합 브릿지 솔루션입니다.

## 문서 바로가기

https://homenet2mqtt-docs.vercel.app

## 주요 기능 및 지원 모드

- **MQTT 연동 모드 (Homenet2MQTT)**: 기기 상태를 MQTT 토픽으로 변환하고 Home Assistant의 MQTT Discovery 규격을 사용하여 간편하게 자동 등록합니다.
- **Matter 연동 모드 (Homenet2Matter)**: 로컬 mDNS 통신을 기반으로 기기를 Matter 브릿지로 노출하여, 추가 브로커나 연동 모듈 없이 애플 홈/스마트싱스/구글 홈 앱에서 직접 기기 추가(QR 코드)로 즉시 연동 및 작동합니다.
- **실시간 패킷 모니터링**: 내장된 웹 UI를 통해 RS485 통신 상태를 모니터링하고 분석에 활용합니다.

## 빠른 요약

- **권장 설치 방법**: Home Assistant Add-on (`homenet2mqtt` 또는 `homenet2matter`)
- **NAS/서버 사용자**: Docker Compose (`network_mode: host` 권장)
- **첫 실행 검증**: Web UI 접속 → 연결 상태 확인 (MQTT 상태 또는 Matter 페어링 대기) → 패킷 모니터 동작 확인

## 개발 관련

- 워크스페이스 빌드: `pnpm build`
- 린트 및 포맷: `pnpm lint`, `pnpm format`
- 테스트: `pnpm test`

## 지원 채널

- [GitHub Issues](https://github.com/wooooooooooook/homenet2mqtt/issues)
- [Discord](https://discord.gg/kGwhUBMe5z)

## 라이선스

MIT

