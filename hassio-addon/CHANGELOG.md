v1.4.0
- feat: automation의 action - send_packet에 header와 footer 옵션을 추가하였습니다. (기본값 false)

v1.3.0
- feat: automation action에 choose, wait_until, repeat 등 더 많은 로직을 구현할수 있게되었습니다.
  - [자동화 설정 가이드](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/blob/main/docs/AUTOMATION.md#)
  - 엔티티에 optimistic옵션을 추가하여 switch,text엔티티를 자동화 변수로 사용하는등 유연한 사용이 가능해졌습니다.
- feat: 강화된 자동화를 기반으로 [uartex](https://github.com/eigger/espcomponents/tree/master/components/uartex)에 구현되어있던 코콤, 현대통신, 삼성SDS 현관문을 업데이트하였습니다.
  - 갤러리에서 설정을 다운받아 적용할 수 있습니다. (작동할지 테스트는 안되었습니다. 되면 제보부탁드립니다.)
- etc: 도커 이미지 다이어트, 성능개선, UI 수정 등..

v1.2.0
- feat: 설정 갤러리 기능 추가.
  - 설정 스니펫을 다운받아 적용할 수 있는 기능을 추가하였습니다. 현재는 기본파일내용 그대로이므로 업데이트할 것은 없습니다.
  - 기본 설정파일에 없던 기능을 추가하거나 아파트별로 다른 환경에 맞춰 업데이트하는데 사용할 수 있습니다. (엘리베이터 기능 추가, 단지별 설정 업데이트 등)
  - 기본 설정파일이 망가진 경우에 업데이트하여 되돌리는데 사용할 수도 있습니다.
  - 설정 스니펫은 github PR을 통해 제공해주실 수 있습니다.
- feat: 스크립트 추가. HA의 automation, script의 관계와 유사합니다. [스크립트 설정 가이드](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/blob/main/docs/SCRIPTS.md)
- feat: automation에 mode를 추가하였습니다. ha의 것과 유사합니다. [자동화 설정 가이드](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/blob/main/docs/AUTOMATION.md#)
- fix: CEL을 사용하는 명령을 가진 엔티티를 HA에서 제어할때 정상적으로 패킷이 생성되지 않는 문제를 수정하였습니다. 
- etc: 성능개선
  
v1.1.0
- feat: 엔티티 강제 활성화기능 추가
  - 비활성화된 엔티티 상세보기 - 관리탭에서 강제 활성화 버튼을 통해 강제 활성화할 수 있습니다. (discovery_always: true 옵션을 추가해주는 기능입니다.)
- feat: 패킷로그 저장기능 옵션 추가. 기본값으로 off 되어있습니다. UI에서 지난 로그를 확인하려면 on 해주세요. 패킷로그저장은 메모리에 이루어지며 애드온을 재시작하면 사라집니다. 24시간마다 파일로 저장하는 옵션도 있습니다.
- feat: raw패킷로그 저장/다운로드 기능 추가 - 분석-raw패킷로그에서 녹화시작/종료를 통해 녹화할 수 있습니다. 녹화된 파일은 버그리포트할 때 혹은 패킷 자료 제공해주실때 첨부해 주시면 도움이 될 것 같습니다.
- etc
  - 대용량 로그 표시 최적화
  - 모바일화면 레이아웃 개선

v1.0.4
- fix: ezville, kocom, cvnet설정의 CEL문법오류수정. 기존설정파일은 자동으로 업데이트 되지 않으니 .initialized 파일을 삭제후 업데이트하여 새로 설정파일을 구성해야합니다.
  - 그 밖에 commax, samsung_sds에서 button 엔티티 오류 수정이 있었으므로 button 엔티티를 사용중이라면 .initialized 파일을 삭제후 업데이트하여 새로 설정파일을 구성해야합니다.
- fix: discovery_always, discovery_linked_id 옵션으로 활성화된 엔티티가 UI에서 활성화되지 않는 문제 수정

v1.0.3
- fix: ezville설정파일에 CEL문법오류가있어 수정했습니다. 기존설정파일은 자동으로 업데이트 되지 않으니 .initialized 파일을 삭제후 업데이트하여 새로 설정파일을 구성해야합니다.

v1.0.2
- fix: ezville같은 2-byte checksum을 사용하는 구성에서 명령패킷에 헤더와 체크섬이 포함되지 않는 문제 수정

v1.0.1
- fix: ha addon환경에서 serial device 매핑 누락 수정 - usb시리얼장치 접근이 안되는 문제 수정입니다

v1.0.0
- **베타버전 진입**
- 알파버전 사용자분들은 설정을 초기화하고 다시 시작하여야합니다.
  - 애드온인 경우 구성에서 config_files를 비워두세요. 그리고 `homenet2mqtt` 폴더에서 `.initialized` 파일을 제거하고 애드온을 재시작하세요.
- 도커컨테이너 실행 지원

- **Breaking Change**
- 보안상의 이유로 lambda 문법이 더 이상 작동하지 않습니다.
  - 기존 설정파일이 동작하지 않을가능성이 매우 큽니다.
  - CEL 문법으로 변경해야 합니다. ([문서 확인](../docs/CEL_GUIDE.md))
  - `.initialized` 파일을 삭제 후 애드온을 재시작하여 새 설정파일을 만들어 시작하시기바랍니다.

v0.4.1
- 영어 지원 강화(i18n)
- 모바일화면레이아웃 개선
- 멀티포트구성에서 초기 설정 실패하더라도 다른 브릿지는 작동하도록 수정

v0.4.0
- 언어지원 추가 (영어)

v0.3.0
- 엔티티 삭제, 디스커버리회수 기능 추가
- 버그수정
- 알파버전표시

v0.2.0
- 성능 최적화
- 로그수집을 동의 받아 수행
- 지연시간측정 테스트

...
  
v0.0.29
- feat: 최근 활동 로그 표시 방식 개선
  - 최신 활동이 목록 하단에 표시되도록 정렬 순서를 변경하고, 새 활동 추가 시 자동으로 스크롤됩니다.
  - 상태 변경 로그에 상세 정보(속성, 이전/이후 값)를 포함하여 가독성을 높였습니다.
  - 로그 생성 로직을 서버로 중앙화하여, 페이지를 새로고침해도 최근 활동이 유지되도록 안정성을 강화했습니다.

v0.0.28
- feat: 대시보드 레이아웃 개편 및 실시간 '최근 활동' 기능 추가
  - MQTT 및 포트 메타데이터 표시부를 최소화하여 공간 효율성 개선
  - 각 포트 탭 하단에 지난 24시간 동안의 주요 활동(상태 변경, 명령 전송 등)을 실시간으로 보여주는 '최근 활동' 패널 추가

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
