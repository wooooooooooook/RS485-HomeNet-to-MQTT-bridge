# Automation 블록 사양

`homenet_bridge.automation`은 수신 상태/패킷/주기/시동 이벤트를 감지해 MQTT 발행이나 장치 명령을 실행하는 규칙 엔진이다. 기존 엔티티 설정에서 사용하는 `StateSchema`/`CommandSchema`와 CEL 표현식을 재사용하며, 모든 예시는 `homenet_bridge` 최상위 키 안에서 작성한다.

## 기본 구조
```yaml
homenet_bridge:
  automation:
    - id: automation_1            # 필수, 전역 유니크
      name: "자동화1"             # 선택
      description: "설명"         # 선택
      trigger:                    # 하나 이상
        - type: state | packet | schedule | startup
          ...                     # 트리거별 세부 필드
          guard: "data[0] == 1"   # 선택, CEL 표현식이 true 일 때만 then 실행
      then:                       # 필수, guard 통과 시 순차 실행
        - action: command | publish | log | delay | send_packet
          ...                     # 액션별 세부 필드
      else: []                    # 선택, guard=false 일 때 실행
      enabled: true               # 기본값
```

### 트리거
- `type: state`
  - `entity_id`: 엔티티 `id`.
  - `property`: 상태 필드명(`state_on` 등). 생략 시 전체 상태 객체를 전달.
  - `match`: 값 비교(`true`, 숫자/문자열, `/regex/`, `{eq|gt|gte|lt|lte}` 오브젝트).
  - `debounce_ms`: 동일 조건 반복을 무시할 시간(ms/`1s` 등 단위 문자열 허용).
- `type: packet`
  - `match`: [`StateSchema`](./config-schema/schemas.md#stateschema) 형태(`data`, `mask`, `offset`, `inverted`). `data`/`mask`로 패킷 바이트를 매칭한다.
- `type: schedule`
  - `every`: 주기 실행 간격(ms 또는 `1s`/`5m`).
  - `cron`: UTC 기준 5필드 cron(`"0 7 * * *"`). `every`와 병행 가능.
- `type: startup`
  - 브릿지 초기화 완료 후 한 번 실행.

### 액션
- `action: command`
  - `target`: `id(<entity>).command_<name>(<value?>)` 형태 문자열. 값은 생략하거나 `input`으로 별도 전달 가능.
  - `input`: 명령에 전달할 값(숫자/문자열/객체).
  - `low_priority`: `true`로 설정 시 일반 명령 큐가 비어있을 때만 실행(기본값 `false`). 단, `schedule` 트리거에 의한 명령은 기본값이 `true`로 자동 설정됨.
- `action: publish`
  - `topic`: 임의 MQTT 토픽.
  - `payload`: 문자열, 숫자, 객체(JSON 직렬화됨).
  - `retain`: MQTT retain 플래그.
- `action: log`
  - `level`: `trace|debug|info|warn|error`(기본 `info`).
  - `message`: 로그 메시지.
- `action: delay`
  - `milliseconds`: 대기 시간(ms 또는 `500ms`/`2s`).
- `action: send_packet`
  - `data`: 전송할 데이터. `number[]` 또는 CEL 표현식(숫자 배열 반환) 사용 가능.
  - `checksum`: `true`일 경우 설정된 알고리즘으로 체크섬을 계산하여 추가 (기본값 `true`).
  - `portId`: 전송할 포트 ID (선택). 기본값은 자동화 설정의 `portId` 또는 실행 컨텍스트의 포트.
  - `ack`: 응답 대기 및 재시도 설정 (선택).
    - `match`: 응답 패킷 매칭 규칙 ([`StateSchema`](./config-schema/schemas.md#stateschema)).
    - `retry`: 재시도 횟수 (기본 5회).
    - `timeout`: 응답 대기 시간(ms, 기본 2000ms).
    - `interval`: 재시도 간격(ms, 기본 125ms).

### Guard 및 CEL 컨텍스트
`guard`나 `send_packet.data` 등의 CEL 표현식에서는 다음 변수에 접근할 수 있습니다.
- `trigger`: 트리거 이벤트 정보 (`trigger.state.value` 등).
- `state`: 트리거된 엔티티의 상태 객체 (state 트리거인 경우).
- `data`: 수신된 패킷 배열 (packet 트리거인 경우).
- `states`: 전체 엔티티 상태 맵.

> **주의**: 기존의 `id()` 헬퍼 함수는 CEL 환경에서 지원되지 않습니다.

### 예시
```yaml
homenet_bridge:
  automation:
    - id: automation_light_follow
      name: "복도 센서 연동"
      trigger:
        - type: state
          entity_id: light_1
          property: state_on
          match: true
      then:
        - action: command
          target: id(light_2).command_on()
    - id: automation_ping
      description: "5분마다 상태 핑"
      trigger:
        - type: schedule
          every: 5m
      then:
        - action: publish
          topic: homenet/bridge/ping
          payload: "alive"
```
