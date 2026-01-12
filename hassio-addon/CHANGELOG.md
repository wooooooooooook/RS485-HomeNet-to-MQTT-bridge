v1.13.0
- samsung_sds기본 설정에서 rx_header를 삭제. samsung_xor체크섬을 신규도입
  - 현관문과 엘리베이터호출에서 b0가 아닌 패킷을 수신하기위한 변경입니다. 
  - 기존 사용자분들은 초기화 한뒤 초기설정마법사를통해 새 구조로 변경해야 갤러리의 samsung_sds파일을 업데이트할 수 있습니다.
- feat: [packet_defaults](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/blob/main/docs/config-schema/packet-defaults.md)에 rx_valid_headers, rx_length_expr 옵션 도입 
  - **rx_valid_headers**: rx_header, rx_footer모두 없는경우 체크섬 충돌가능성이 있는데, rx_valid_headers 배열에 정의된 바이트로 시작하는 경우만 유효한 패킷으로 간주합니다. (삼성sds에서 rx_header를 b0로 쓰던것을 rx_header를 폐지한뒤 발생한 문제를 해결)
  - **rx_length_expr**: rx_length는 동적이지만 패킷에 길이를 나타내는 정보가 있는경우 사용하면 패킷파싱성능향상에 도움이됩니다. (bestin 설정에서 사용)
- 설정에서 로그파일 목록 확인 및 삭제가능.

v1.12.1
- fix: timezone을 설정해도 로그에 UTC로 기록되던 문제 수정. 
- fix: 설정의 로그보관 옵션이 앱 재시작시 초기화되는 문제 수정. 
- schedule 트리거의 timezone 적용 방식을 문서에 명확히 하였습니다. timezone 설정시 로컬타임존을 사용하며 미설정시 UTC를 사용합니다.


v1.12.0
- feat: timezone 옵션 추가. 
  - UI에서는 기존에 브라우저의 타임존을 사용하였으나 서버는 UTC를 사용하여 불일치 문제가있었음.
  - 구성에서 timezone을 설정한경우 서버와 UI의 타임존 일치. 비워두면기존처럼 동작함.
- feat: 로그 보관의 기본 TTL을 1시간, 활성화로 변경하고 TTL을 설정할수있도록 옵션으로 제공.
- feat: 애드온 구성에 항목별 description 추가.
- fix: update_state액션이 parseData와 같은방식으로 상태를 해석하도록 수정함. 
- etc: 성능개선, 보안강화, 접근성 강화 등. 

v1.11.0
> ### **!!breaking change!!** 
> offset의 해석의 일관성을 위해 수정사항이 있으며 이로인해 설정이 깨졌을수 있습니다!
>
> **영향 받은 자동화 목록** - 갤러리에서 수정본 적용 가능
> - ezville 현관문열림
> - hyundai imazu 주기적 조명 상태요청 자동화
> - 삼성sds 현관문 및 엘리베이터 (원래 작동 안됐음.. 지금도 안될겁니다)
>
> **offset은 헤더를 포함한 수신패킷 전체의 0-based index**이며 offset이 생략된경우 offset은 rx_header의 길이로 해석됩니다.
> 따라서 기존에 offset을 생략했을때 offset: 0으로 해석되던 자동화의 packet trigger 사용부분에서 data에서 헤더부분을 삭제하거나 offset: 0으로 설정해야합니다.
> ```yaml
> # 기존 예시
> # 0xAD는 rx_header일 때
> trigger:
>   - type: packet
>     match:
>       data: [0xAD, 0x41, 0x00, 0x6C]
> 
> # 수정된 예시
> trigger:
>   - type: packet
>     match:
>       data: [0xAD, 0x41, 0x00, 0x6C]
>       # offset: 0을 추가하여 헤더를 포함하여 매칭하도록 수정.
>       offset: 0
> 
>       # 혹은 헤더를 삭제.
>       data: [0x41, 0x00, 0x6C]
> ```
- fix: commandSchema의 ack가 offset: 0 으로 해석되어 ack를 못찾는 문제 수정

- feat: 엔티티 yaml 수정시 재시작여부를 묻는 모달 추가
- feat: 마지막 남은 브릿지를 제거하면 초기 설정 마법사가 실행됩니다.
- feat: mqtt cleanup 기능 추가. 설정-애플리케이션 관리에서 실행할 수 있으며 {prefix} (기본값 homenet2mqtt) 이하 모든 토픽을 삭제하고 재발행합니다. 설정파일 수정 등 이전 메시지가 지저분하게 남는경우 사용하세요. 
- fix: climate의 preset discovery 오류 수정


v1.10.0
- feat: 일정시간 패킷이 수신되지 않으면 시리얼에 재연결을 시도하는 로직 추가.
  - config파일에 serial에 `serial_idle`를 옵션으로 추가할수 있습니다. 기본값은 10분이며, `0`으로 설정하면 비활성화됩니다.
  - [serial 설정 가이드](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/blob/main/docs/config-schema/serial.md)
- feat: light, fan에도 optimistic 옵션을 사용할 수 있습니다.
- fix:
  - 아이폰 모바일에서 엔티티상세모달 등 일부모달이 나타나지 않는 문제 수정
  - climate에서 `preset modes[]` 설정없이 `state_preset_*`으로 설정한 프리셋도 디스커버리에서 포함, 상태해석 되도록 수정
  - UI 레이아웃 수정

v1.9.2
- state_update 액션에서 offset이 헤더를 제외하고 계산되던 오류 수정
  
v1.9.1
- TCP 재연결 기능 보완 (ew11 사용시 끊어져도 재연결하지 않던 문제 수정)

v1.9.0
- feat: script에 args지원 추가.
- checksum type에 bestin_sum 추가
  - bestin 지원을 위해 작업중입니다..
- 성능개선

v1.8.0
- feat: 자동화 액션에 state_update를 추가.
  - [state_update](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/blob/main/docs/AUTOMATION.md#%EC%83%81%ED%83%9C-%EA%B0%B1%EC%8B%A0-update-state)
- feat: packet log 검색기능추가 및 성능최적화
- 로그보관으로 로그가쌓이는경우 성능저하가 심하여 기간을 24->6시간으로 줄였습니다.
  - 그럼에도 로그가 쌓이면 분석페이지 진입 및 로그확인에 지연이 심하므로 분석이 꼭 필요한 경우가 아니면 로그보관을 끄고 사용하세요.
- 각종 성능개선 및 ui수정

v1.7.0
- feat: commandSchema에 ack를 추가하였습니다. [schema 가이드](https://github.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/blob/main/docs/config-schema/schemas.md#CommandSchema)
  - 기존: 명령패킷 전송 후 해당 엔티티의 상태변화가 있으면 전송 성공으로판단.
  - 변경: ack가 정의된경우 상태변화와 ack패킷 중 먼저온 것을 성공으로 판단. (button 등 state가 없는 엔티티에서도 ack판단이 가능해졌습니다.)
- fix: 명령이 없는 엔티티가 대시보드에 나타나지 않는 문제 수정
- fix: 엔티티와 스크립트/자동화의 id가 겹칠수 있어 UI가 마비되는 현상 -> id가 중복되지 않도록 자동수정하도록 했습니다.
- etc: 성능 최적화
- gallery: 현대 imazu 현관문(주방폰에 별도 포트연결필요), 이지빌 스마트플러그(F750패킷) 추가

v1.6.1
- config_files를 기본값으로 비워뒀을때 `WARN: [service] CONFIG_FILES에 단일 값이 입력되었습니다. 쉼표로 구분된 배열 형식(CONFIG_FILES=item1,item2) 사용을 권장합니다.` 경고가 뜨는문제 수정
- 마지막 남은 브릿지를 삭제할수 없도록 수정
- 비활성화 보기 토글을 유지하여 비활성화엔티티 삭제 편의성 향상

v1.6.0
- 초기설정마법사를 강화: 예제 뿐 아니라 시리얼 직접설정을 지원, 포함할 엔티티 체크 추가.
- 멀티포트환경을 더 쉽게 이용할 수 있도록 브릿지추가마법사를 추가하고 설정에서 브릿지 추가/삭제를 할 수 있도록 했습니다.
- 대시보드에서 automation과 script를 엔티티처럼 확인할 수 있습니다. 클릭하면 액션을 바로 실행하거나 자동화/스크립트 실행 기록을 확인할 수 있습니다.
- raw패킷 로그에서 유효패킷만 보기 옵션을 추가 : 헤더,푸터,체크섬이 유효한 패킷만 보여줍니다. usb시리얼장치사용하는 분들도 패킷을 쉽게 확인할 수 있습니다.
- 분석페이지에 패킷전송기를 추가하여 테스트목적의 패킷전송이 가능합니다.
- 재시작기능 추가.
- etc: UI 수정, 성능 최적화 등.. 


v1.5.1
- fix: text_sensor의 디스커버리타입을 sensor로 수정하여 HA에 정상등록되도록 수정했습니다 

v1.5.0
- feat: state schema에 guard와 except옵션을 추가했습니다.
  - 패킷매칭후에 판단하여 예외 처리할 수 있게되었습니다.
- feat: 패킷 파서를 별도 워커에서 실행하도록 분리하여 데이터 양이 많은 환경에서도 mqtt와 ui서버제공에 부하가 가지 않도록 개선했습니다.
- feat: 분석 페이지에 CEL테스트기를 추가
- etc: ui수정, 갤러리 엔티티 추가 등

v1.4.1
- state_* CEL 표현식에서 이전 상태 값을 참조할 수 있도록 state 참조가능.

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
