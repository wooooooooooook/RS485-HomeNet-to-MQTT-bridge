v0.0.24
- fix: MQTT 접두사가 포함된 토픽에서도 포트 ID를 일관되게 해석하도록 백엔드/프론트 포트 정규화 통합

v0.0.22
- fix: 대시보드 초기 접속 시 MQTT 상태 캐시를 재전송하도록 개선

v0.0.21
- feat: 멀티포트 UI 반영

v0.0.20
- refactor: 설정파일 구성 변경

v0.0.19
- feat: MQTT 공통 접두사(mqtt_common_prefix) 설정 추가

v0.0.18
- fix: MQTT 기본 토픽 구조 변경에 맞춰 테스트 및 기본 프리픽스 정비

v0.0.17
- fix: run.sh 실행을 위해 bash 패키지 추가

v0.0.16
- fix: 애드온 실행 스크립트를 bash로 변경하여 실행 오류 해결

v0.0.15
- feat: multi port 지원 시작

v0.0.14
- feat: 엔티티 이름변경 및 ha반영

v0.0.13
- feat: device, area지정 추가 (esphome의 설정과 유사)

v0.0.12
- feat: 비활성화엔티티보기 토글 추가

v0.0.11
- feat: 개별엔티티 config 수정 기능
- refactoring: 패킷 로그화면 재구성
- 모바일화면 개선
  
v0.0.10
- feat: raw패킷 로그를 시작할 때만 스트리밍하여 네트워크 부하 절약
