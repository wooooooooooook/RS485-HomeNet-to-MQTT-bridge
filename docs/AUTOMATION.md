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

### 시작 트리거 (Startup Trigger)
애플리케이션이 시작될 때(부팅 시) 실행됩니다. `delay` 옵션은 제거되었으므로, 지연 실행이 필요한 경우 `action` 단계에서 `delay`를 사용해야 합니다.
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
low_priority: true # 선택사항. 기본값: false (일반 우선순위)
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
checksum: false # 선택사항. 기본값: true (설정된 체크섬 알고리즘 자동 적용)

# 응답 대기 (ACK) 설정
# 단순 배열 또는 CEL 표현식을 사용하여 수신될 응답 패킷을 정의합니다.
ack: [0x06]
# 또는
# ack: "data[0] == 0x06"
```

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
