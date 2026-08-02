** ⚠️ 업데이트 전 백업 권장 **
- 오류가 있으면 homeassistant [카페](https://cafe.naver.com/koreassistant), [깃헙](https://github.com/wooooooooooook/homenet2mqtt), [디스코드](https://discord.gg/kGwhUBMe5z) 등으로 알려주세요.

v3.0.7
- fix: 멀티포트 환경에서 하나의 포트에 오류가 있을 때 정상포트에서 raw패킷로그, 인터페이스로그가 올라오지 않는 문제 수정
- improvement: state cache의 읽기 쓰기를 비동기로 전환
- etc: 기타 최적화

v3.0.6
- 아래 수정으로 멀티포트환경에서 첫번째 포트에 여러포트의 엔티티가 섞이는 등 문제가 수정됩니다.
- fix: state_cache가 multiport를 지원하지 않는 문제 수정
- fix: state_cache복원 과정에서 삭제되거나 이름변경 등으로인해 존재하지 않는 엔티티를 강제로 생성하는 문제 수정


v3.0.5
- fix: 시작 직후 UI가 업데이트되지 않는 현상 수정
- fix: matter버전에 mqtt관련 옵션이 노출되던 문제 수정
- fix: `state_class`옵션을 `state_*`로 보고 `stateSchema`로 해석하려는 문제 수정
- fix: `state_class` 및 `unit_of_measurement`옵션이 sensor, number 이외의 엔티티에서도 discovery에 발행되던 문제 수정


v3.0.1 - v3.0.4 Hotfix
- fix: mqtt애드온에 불필요한 포트매핑제거
  - 업데이트후 mqtt애드온이 실행안되시는분은 구성에서 네트워크설정을 기본값으로 재설정해주세요.
- fix: 일부 설정에서 mqtt애드온이 matter버전으로 실행되던 문제 수정
- fix: matter 애드온에서 멀티포트 구성시 첫번째 포트의 페어링정보만 노출되던 문제 수정
- fix: 모바일에서 분석페이지 ui 깨짐 수정
- fix: 일부 설정파일 편집시 INVALID_FILENAME으로 편집불가한 문제 수정
- chore: 애드온의 config_files 구성 기본값을 빈칸으로 변경. 자동으로 설정폴더에서 지원하는 설정파일들을 읽어서 각각의 브릿지로 구성합니다.

v3.0.0
- ### Homenet2Matter (beta) 출시!! 
  - 이제 h2m은 homenet2mqtt와 homenet2matter모두를 의미합니다.
  - **기존 h2mqtt사용지분들은 별도의 조치없이 그대로 이용할 수 있습니다.** 
  - h2mqtt와 h2matter는 같은 코드를 공유하며 편의를 위해 별도의 앱으로 분리했습니다.
  - h2matter를 이용하려면 별도의 h2matter 앱(애드온)을 설치하거나 도커로 설치시 integration type을 matter로 명시하면됩니다. 
  - matter는 다양한 테스트환경을 준비하기어려워 **오류가 많을것으로 예상**됩니다..
- feat: 분석탭에 h2m과 mqtt 혹은 matter 사이 통신을 로깅하는 인터페이스로그 추가
- fix: `optimistic: true`인 엔티티에서 `command_*`를 비워둔경우 패킷전송 시도를 하지 않도록 수정.: 여전히 오류가 있어서 다시 수정
- ui: 기기목록뷰 추가
- ui: 엔티티정보 창에 상세정보탭 추가
- ui: 분석탭 - 패킷로그(Rx/Tx)와 raw패킷로그 통합
- chore: ha app의 TIMEZONE 기본값을 Asia/Seoul로 지정함


v2.15.2
- fix: `optimistic: true`인 엔티티에서 `command_*`를 비워둔경우 패킷전송 시도를 하지 않도록 수정.


v2.15.0 - 2.15.1
- feat: `fan` entity에 `speed_range_min`, `speed_range_max` 옵션 추가.
- feat: `optimistic: true`인 엔티티에서 StateSchema/StateNumSchema대신 빈값 입력을 허용합니다. 빈값인경우 아무 패킷에도 매칭되지 않습니다. 가상엔티티를 만들때 유용하게 쓰입니다.
- fix: `restore_mode`로 복원된 optimistic 엔티티의 상태가 UI 대시보드에 반영되지 않는 문제 수정
- fix: 자동화 처리로 송신된 패킷 로그가 수신 패킷 로그보다 먼저 기록되는 로깅 타이밍 문제 수정
- fix: `update_state`액션에서 허용되는 키 검증이 제대로 이루어지지 않는 문제 수정 및 검증 강화
- fix: 자동화의 시작 시점을 앱 시작 후 초기화가 완료된 시점으로 변경.
- chore: nodejs 버전업 22 -> 24
- chore: [CommandManager] Trying to send command 로그 레벨을 INFO에서 DEBUG로 하향하고 TRACE레벨에서 송신패킷값 로그 출력 추가.


v2.14.0
- feat: 자동화 trigger에 id를 추가하여 이를 통해 자동화내에서 분기처리가 가능하도록 했습니다. [문서보기](https://homenet2mqtt-docs.vercel.app/guide/automation.html#%E1%84%90%E1%85%B3%E1%84%85%E1%85%B5%E1%84%80%E1%85%A5-triggers)
- feat: 자동화 action - update_state의 target_id가 CEL도 받을 수 있도록 개선. [문서보기](https://homenet2mqtt-docs.vercel.app/guide/automation.html#update-state)
- fix: `restore_mode` 사용 시 복원된 상태가 MQTT 브로커로 다시 발행되지 않아 대시보드에 상태 정보가 유실되던 문제 수정
- fix: 자동화 `send_packet` 실행 시 CEL 평가 오류 등이 발생했을 때 에러로 처리되어 활동로그에 기록되도록 개선


v2.13.1
- ui: 설정, 분석화면의 네비게이션 개선
- ui: 모바일 환경에서 editor에 붙여넣기 권한이 없는 경우 우회하여 붙여넣기 가능한 모달창 제공

v2.13.0
- feat: `optimistic: true`인 엔티티에 사용할 수 있는 `restore_mode`옵션 추가 (`ALWAYS_ON`, `ALWAYS_OFF`, `RESTORE_DEFAULT_ON`, `RESTORE_DEFAULT_OFF` 지원, 기본값 `ALWAYS_OFF`)
- fix: CEL 분석기가 상세오류내용을 표시하도록 수정
- fix: 자동화의 action이 실패하더라도 활동로그에 남지 않는 문제 수정
- chore: 문서와 예제에 남아있는 offset을 index로 수정

v2.12.2
- fix: select 엔티티에서 command_select를 해석하지 않는 문제 수정.


v2.12.1
- ui: 설정화면과 분석화면을 정리했습니다.
- 로그수집을 설치시 동의후 계속 수집하는 방식에서 설정화면에서 1회성으로 버튼을 눌러 수행하는 방식으로 변경했습니다.


v2.12.0
- feat: 5분간(기본값, 설정가능) serial혹은 mqtt연결 실패시 자동으로 애드온을 재시작하는 기능 추가

v2.11.5
- fix: 엔티티 삭제시 mqtt retain message도 삭제하도록 수정


v2.11.4
- fix: mqtt 연결 끊김 후 재연결시 offline상태가 안풀리는 문제 수정


v2.11.3
- fix: 갤러리 댓글 기능이 homeassistant ingress환경에서는 작동하지 않는 문제 개선
  - ha ingress에서는 github login이 불가하여 giscus댓글작성이 안되어 우회하여 github discussion링크와 개발자계정으로 댓글 남기기 지원
- 기타 안정화 및 최적화

v2.11.2
- fix: 불필요한 셀프 mqtt 발행-구독 루프 차단
- 기타 안정화 및 최적화

v2.11.1
- fix: log level을 warning으로 설정시 crash발생 오류 수정
- fix: 설정과정에서 scripts가 중복으로 추가되는 오류 수정

v2.11.0
- beta를 종료하고 stable 버전으로 운영합니다
  - 분명 잘 안쓰이는 기능에는 버그가 많을것으로 예상되지만 1-2달간 특별한 오류 제보가 없어 stable로 전환합니다.
  - 언제든 오류 제보 환영합니다. 디스코드, 깃헙, 홈어시스턴트 카페 등 편하신곳으로 알려주세요.
- 모든 설정의 offset항목을 index로 치환하였습니다. offset으로 설정된 파일도 사용가능합니다.
  - [uartex](https://github.com/eigger/espcomponents/tree/master/components/uartex)의 스키마를 따오는 과정에서 제 지식 부족으로인해 의미상 index인것을 offset으로 사용하고있어서 이번에 바로잡았습니다.
  - 하위호환성을 챙겼으므로 기존 설정파일을 그대로 사용해도됩니다.
- 갤러리 기능 개선
  - 모호한 표현들을 정리하여 더 직관적으로 이해할 수 있도록 개선하고 조금더 이해가능한 플로우로 진행할 수 있도록 노력했습니다.
  - 혹시나 갤러리 스니펫 제작가능하신분들을 위해(계실지는 모르겠으나..) 다른 저장소의 파일도 불러올 수 있도록 했습니다. 설정에서 갤러리부분에 저장소주소를 수정할 수 있습니다.
  - **댓글기능**(giscus: github로그인 필요)을 추가하여 사용자간 정보공유가 가능합니다.
- climate의 visual 옵션들의 타입을 숫자로 정규화함
- 기타 UI 개선

... 이전 내역은 [CHANGELOG_OLD.md](https://github.com/wooooooooooook/homenet2mqtt/blob/main/hassio-addon/CHANGELOG_OLD.md)에 기록되어 있습니다.
