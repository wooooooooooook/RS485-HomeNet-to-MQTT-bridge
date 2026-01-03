# 자동화 (Automation) 가이드

HomenetBridge는 상태 변경, 패킷 수신, 스케줄 또는 시스템 시작과 같은 이벤트에 따라 자동으로 작업을 수행할 수 있는 자동화 기능을 제공합니다.

## 트리거 (Triggers)

자동화를 실행하는 조건입니다.

### 상태 트리거 (State Trigger)
특정 엔티티의 상태가 변경되고 조건이 일치할 때 실행됩니다.
```yaml
trigger:
  - type: state
    entity_id: light_1
    property: state_on  # 선택사항. 생략 시 전체 상태 객체 비교
    match: true         # 값 또는 조건 객체 { gt: 10, lt: 20 }
    debounce_ms: 100    # 선택사항. 기본값: 0 (즉시 실행)
```

### 패킷 트리거 (Packet Trigger)
정의된 스키마와 일치하는 원본(Raw) 패킷이 수신될 때 실행됩니다.
```yaml
trigger:
  - type: packet
    match:
      data: [0xAA, 0x55]
      offset: 0
```

### 스케줄 트리거 (Schedule Trigger)
주기적으로 또는 특정 시각(Cron)에 실행됩니다.
```yaml
trigger:
  - type: schedule
    every: 5m      # 5분마다 실행
    # 또는
    cron: '0 0 * * *' # 매일 자정에 실행
```

> **참고**: 스케줄 트리거가 포함된 자동화의 모든 `command` 액션은 기본적으로 `low_priority: true`로 설정됩니다. 이는 주기적인 폴링이나 비동기 작업이 사용자의 실시간 명령(조명 제어 등)을 방해하지 않도록 하기 위함입니다. 이를 원치 않는 경우 `low_priority: false`를 명시적으로 설정하세요.

### 시작 트리거 (Startup Trigger)
애플리케이션이 시작될 때(부팅 시) 실행됩니다. 지연 실행이 필요한 경우 `action` 단계에서 `delay`를 사용해야 합니다.
```yaml
trigger:
  - type: startup
```

## 액션 (Actions)

트리거 조건이 충족되었을 때 수행할 작업입니다.

### 명령 (Command)
엔티티에 제어 명령을 보냅니다.
```yaml
action: command
target: id(light_1).command_on()
# 또는
target: id(climate_1).command_target_temp(24)
low_priority: true # 선택사항. 기본값: false (단, 스케줄 트리거가 포함된 자동화에서는 기본값: true)
# true로 설정 시, 일반 큐가 비어있을 때만 명령이 전송됩니다. (Polling 등 중요도가 낮은 명령에 사용)
```

### 발행 (Publish - MQTT)
MQTT 토픽으로 메시지를 발행합니다.
```yaml
action: publish
topic: homenet/event
payload: "something happened"
retain: true # 선택사항. 기본값: false
```

### 패킷 전송 (Send Packet - Raw)
장치로 직접 원본 패킷을 전송합니다. `ack` 옵션을 사용하여 응답 패킷을 기다릴 수 있습니다.
```yaml
action: send_packet
data: [0x02, 0x01, 0xFF]
# 또는 CEL 사용
data: "[0x02, x, 0xFF]" # x 변수 사용 가능 (문맥에 따라)
header: true # 선택사항. true: config의 tx_header 사용, [0xAA]: 직접 지정, false(기본값): 사용 안 함
footer: true # 선택사항. true: config의 tx_footer 사용, [0xEE]: 직접 지정, false(기본값): 사용 안 함
checksum: false # 선택사항. 기본값: true (설정된 체크섬 알고리즘 자동 적용)

# 응답 대기 (ACK) 설정
# 단순 배열 또는 CEL 표현식을 사용하여 수신될 응답 패킷을 정의합니다.
ack: [0x06]
# 또는
# ack: "data[0] == 0x06"
```

### 상태 갱신 (Update State)
수신된 패킷(패킷 트리거)에서 값을 추출해 엔티티 상태를 직접 갱신합니다. `state` 항목은 `StateSchema/StateNumSchema`로 정의합니다.

```yaml
action: update_state
target_id: light_1
state:
  state_on:
    offset: 5
    data: [0x10, 0x01]
  state_off:
    offset: 5
    data: [0x10, 0x00]
  brightness:
    offset: 4
    length: 1
```

- `state` 값이 `StateSchema/StateNumSchema`인 경우, 패킷에서 값을 추출하여 상태로 기록합니다.
- 패킷 트리거가 아닌 경우에는 상수 값만 안전하게 사용하세요.
- `state_on`/`state_off` 또는 `on`/`off` 키가 불리언으로 갱신되면 `state: 'ON' | 'OFF'` 형태로 변환되어 저장됩니다.
- `update_state`는 대상 엔티티에 정의된 `state_*` 항목과 해당 속성명(예: `brightness`, `target_temperature`)만 허용하며, 정의되지 않은 속성은 오류로 처리됩니다.
- `update_state`로 상태가 변경되면 `state:changed` 이벤트가 발행됩니다.

### 지연 (Delay)
일정 시간 동안 대기합니다.
```yaml
action: delay
milliseconds: 1000 # 또는 '1s'
```

### 로그 (Log)
시스템 로그에 메시지를 기록합니다. 디버깅 용도로 유용합니다.
```yaml
action: log
level: info # trace, debug, info, warn, error. 기본값: info
message: "자동화가 실행되었습니다."
```

### 스크립트 실행 (Script)
사전에 정의한 `scripts` 블록의 액션 시퀀스를 실행합니다. 설정 방법은 [SCRIPTS.md](./SCRIPTS.md)를 참고하세요.

```yaml
action: script
script: warm_start
```

### 조건문 (If)
CEL 표현식을 평가하여 조건에 따라 다른 액션을 실행합니다.
```yaml
- action: if
  condition: "states['sensor_temp']['value'] < 18"
  then:
    - action: command
      target: id(heater_1).command_on()
  else:  # 선택사항
    - action: command
      target: id(heater_1).command_off()
```

### 다중 조건 분기 (Choose)
여러 조건을 순차적으로 평가하여 첫 번째로 일치하는 조건의 액션을 실행합니다. 중첩된 `if-else`보다 가독성이 좋습니다.

```yaml
- action: choose
  choices:
    - condition: "states['door_state']['state'] == 'D_IDLE'"
      then:
        - action: send_packet
          data: [0xB0, 0x41, 0x00]
    - condition: "states['door_state']['state'] == 'D_CALL'"
      then:
        - action: send_packet
          data: [0xB0, 0x36, 0x01]
    - condition: "states['door_state']['state'] == 'D_OPEN'"
      then:
        - action: send_packet
          data: [0xB0, 0x3B, 0x00]
  default:  # 선택사항 - 일치하는 조건이 없을 때 실행
    - action: send_packet
      data: [0xB0, 0x42, 0x00]
```

> **참고**: `choose`는 첫 번째로 일치하는 조건만 실행하고 종료합니다. 여러 조건이 동시에 참일 수 있더라도 첫 번째 것만 실행됩니다.

### 자동화 중지 (Stop)
현재 자동화의 실행을 즉시 중지합니다. 이후 액션은 실행되지 않습니다.

```yaml
- action: if
  condition: "states['safety_mode']['state'] == 'on'"
  then:
    - action: stop
      reason: "안전 모드에서는 실행하지 않음"  # 선택사항 - 로그에 기록됨
- action: command
  target: id(door).command_open()  # 위에서 stop이 실행되면 이 액션은 건너뜀
```

**사용 사례:**
- 특정 조건에서 자동화를 조기 종료
- 안전 가드 구현
- 에러 상황에서 실행 중단

### 반복문 (Repeat)
액션을 여러 번 반복 실행합니다.

**고정 횟수 반복:**
```yaml
- action: repeat
  count: 3
  actions:
    - action: send_packet
      data: [0x01, 0x02]
    - action: delay
      milliseconds: 100
```

**조건 기반 반복 (while):**
```yaml
- action: repeat
  while: "states['switch_1']['power'] == 'on'"
  max: 10  # 안전을 위한 최대 횟수 (필수, 기본값: 100)
  actions:
    - action: send_packet
      data: [0x01, 0x02]
    - action: delay
      milliseconds: 500
```

> **주의**: `while`을 사용할 때는 반드시 `max`를 지정하거나 루프 내에서 조건이 변경되도록 해야 합니다. 무한 루프를 방지하기 위해 최대 반복 횟수가 제한됩니다.

### 조건 대기 (Wait Until)
특정 조건이 충족될 때까지 대기합니다. 타임아웃을 설정할 수 있으며, 조건은 CEL 표현식으로 평가됩니다.

```yaml
- action: wait_until
  condition: "states['binary_sensor_1']['state'] == 'off'"
  timeout: 5s          # 선택사항. 기본값: 30s
  check_interval: 200  # 선택사항. 폴링 간격(ms). 기본값: 100ms
```

**사용 예시 - 현관문 벨 자동 열기:**
```yaml
- action: wait_until
  condition: "states['doorbell']['state'] == 'off'"
  timeout: 10s
- action: delay
  milliseconds: 1000
- action: command
  target: id(door_open).command_press()
```

> **팁**: `wait_until`은 조건이 충족되거나 타임아웃이 발생하면 즉시 다음 액션으로 진행합니다. 타임아웃 발생 시 경고 로그가 기록되지만 자동화는 계속 진행됩니다.

## 가드 (Guards - 조건)

트리거 또는 자동화 전체에 `guard` 조건을 추가하여 특정 상황에서만 실행되도록 제한할 수 있습니다. 가드는 CEL 표현식을 사용합니다.

```yaml
automation:
  - id: auto_light
    trigger:
      - type: state
        entity_id: sensor_lux
    # 조도 센서 값이 100 미만일 때만 실행
    guard: "states['sensor_lux']['illuminance'] < 100"
    then:
      - action: command
        target: id(light_1).command_on()
```

## 실행 모드 (Mode)

자동화가 이미 실행 중일 때 새 트리거가 발동되면 어떻게 처리할지 지정합니다.

| Mode | 동작 |
|------|------|
| `parallel` | 병렬 실행 (기본값) |
| `single` | 이미 실행 중이면 새 트리거 무시 |
| `restart` | 이미 실행 중이면 취소하고 새로 시작 |
| `queued` | 큐에 넣고 순차 실행 |

```yaml
automation:
  - id: elevator_call_response
    mode: restart  # 새 트리거 시 이전 실행 취소
    trigger:
      - type: packet
        match:
          data: [0xAD, 0x41, 0x00, 0x6C]
    then:
      - action: send_packet
        data: [0xB0, 0x2F, 0x01, 0x1E]
      - action: delay
        milliseconds: 20s
      - action: command
        target: id(elevator_call).command_off()
```

> [!TIP]
> `restart` 모드는 딜레이가 있는 자동화에서 유용합니다. 새 트리거가 발동되면 이전 딜레이가 취소되고 처음부터 다시 시작합니다.

## 실행 기록 (Dashboard)

자동화가 트리거될 때, 가드 통과/실패 여부, 그리고 각 액션 실행 시점이 활동 로그로 기록됩니다. 이 기록은 대시보드의 자동화 상세보기와
분석 페이지에서 확인할 수 있습니다. 로그 기록은 성능 부담을 줄이기 위해 짧은 지연을 두고 버퍼링되어 순차 전송될 수 있습니다.
분석 페이지의 **자동화/스크립트 기록** 카드에서 확인할 수 있으며, 로그 유지(Log retention) 설정에 포함됩니다.
