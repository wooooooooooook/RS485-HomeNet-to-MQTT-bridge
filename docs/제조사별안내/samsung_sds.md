# 삼성 SDS 홈넷 설정 안내

삼성 SDS 홈넷 시스템의 RS485 브릿지 연결 및 설정 가이드입니다.

## ⚠️ 중요: 시리얼 포트 설정

**삼성 SDS는 다른 제조사와 달리 Parity가 `EVEN`입니다.**

대부분의 홈넷 제조사(코콤, CVNet 등)는 parity를 `NONE`으로 사용하지만, 삼성 SDS는 **반드시 `EVEN` parity**를 설정해야 정상적으로 통신할 수 있습니다.

```yaml
homenet_bridge:
  serial:
    path: /dev/ttyUSB0   # 또는 EW11 주소 (예: 192.168.0.100:8899)
    baud_rate: 9600
    data_bits: 8
    parity: EVEN         # ⚡ 필수: 반드시 EVEN으로 설정
    stop_bits: 1
```

> 💡 **parity 설정 오류 시 증상**: 패킷이 깨지거나, 전혀 수신되지 않거나, checksum 오류가 계속 발생합니다.

## 패킷 기본 설정

삼성 SDS 전용 checksum 방식을 사용합니다:

```yaml
  packet_defaults:
    rx_timeout: 10ms
    tx_delay: 50ms
    tx_timeout: 500ms
    tx_retry_cnt: 3
    rx_header: [0xB0]
    rx_checksum: samsung_rx
    tx_checksum: samsung_tx
```

---

## 엘리베이터·현관문 연동 시 주의사항

### 🔌 권장: RS485-USB 시리얼 장치 사용

엘리베이터 호출, 현관문 개폐 등 **현관스위치 기능을 연동**하려면 다음 방법을 권장합니다:

1. **현관스위치를 물리적으로 탈거**하고, 연결되어 있던 **RS485 신호선을 뽑아둡니다**.
   - 목적은 현관스위치를 RS485 라인에서 **완전히 제거(무력화)**하는 것입니다.
   - 현관스위치를 제거하지 않으면, 브릿지와 현관스위치가 동시에 응답하여 충돌이 발생합니다.
2. **RS485-USB 시리얼 변환기**(USB to RS485 동글 등)를 메인 RS485 라인에 연결합니다.
   - 현관스위치가 있던 자리에 연결할 필요는 **없습니다**.
   - 기존에 사용하던 RS485 연결 위치(월패드 등)에 그대로 연결하면 됩니다.

```
┌─────────────┐                       ┌─────────────────┐
│  월패드     │ ←── RS485 (A, B) ──→ │  RS485-USB 변환기│ ←──→ PC/서버
│  (엘리베이터)│                       │  (예: CH340기반) │
└─────────────┘                       └─────────────────┘
        ✕ 현관스위치 (탈거하여 무력화)
```

**이유:**
- 현관스위치 연동은 **요청-응답 타이밍이 매우 중요**합니다.
- 월패드가 현관스위치에 주기적으로 상태를 질의하며, 일정 시간 내에 응답하지 않으면 통신 실패로 처리합니다.
- 직접 연결된 RS485-USB 장치는 지연 시간이 최소화되어 **안정적인 응답**이 가능합니다.

> ⚠️ **주의:** 현관스위치를 무력화하면 **현관스위치의 조명 일괄 차단(외출 모드) 기능이 동작하지 않습니다**.  
> 해당 기능이 필요한 경우, Home Assistant 등에서 자동화를 구성하여 대체해야 합니다.

### ⚠️ EW11 (WiFi-RS485 변환기) 사용 시

EW11 등 WiFi 기반 RS485 변환기로도 시도해 볼 수 있으나, **권장하지 않습니다**.

**문제점:**
- WiFi 네트워크의 지연 시간(latency)이 일정하지 않습니다.
- 요청-응답 간 **타이밍을 정확히 맞추기 어렵습니다**.
- 간헐적으로 응답 시간이 초과되어 통신 실패가 발생합니다.

> 조명, 난방 등 상태 모니터링 용도로는 EW11도 사용 가능하지만,  
> **엘리베이터·현관문처럼 요청-즉시응답이 필요한 기능**은 EW11로는 어렵습니다.

### 📋 현관스위치 종류 확인 (구형 vs 신형)

엘리베이터·현관문 연동 시 **현관스위치의 종류에 따라 다른 설정 파일**을 적용해야 합니다.

| 구분 | 패킷 헤더 | 갤러리 설정 파일 |
|------|-----------|------------------|
| **구형** 현관스위치 | `0xAD` | `elevator_old_full.yaml` 또는 `elevator_old_minimal.yaml` |
| **신형** 현관스위치 | `0xCC` | `elevator_new.yaml` |

**확인 방법:**
1. 브릿지를 RS485 라인에 연결합니다.
2. UI의 **Raw Packet Log**에서 수신되는 패킷을 확인합니다.
3. 현관스위치 관련 패킷의 첫 번째 바이트(헤더)를 확인합니다:
   - `AD XX XX XX` → **구형** 스위치
   - `CC XX XX XX` → **신형** 스위치

**갤러리 설정 적용:**
- 구형 (AD): [`gallery/samsung_sds/elevator_old_full.yaml`](../../gallery/samsung_sds/elevator_old_full.yaml)
- 신형 (CC): [`gallery/samsung_sds/elevator_new.yaml`](../../gallery/samsung_sds/elevator_new.yaml)

> ⚠️ **주의:** 잘못된 설정 파일을 적용하면 패킷 매칭이 되지 않아 엘리베이터 호출이 동작하지 않습니다.

---

## 지원 기기 예시

삼성 SDS 홈넷에서 지원되는 기기 설정 예시입니다.

### 조명 (Light)

```yaml
light:
  - name: 'Light 1'
    state:
      data: [0x79, 0x21]
    state_on:
      offset: 2
      data: [0x01]
      mask: [0x01]
    state_off:
      offset: 2
      data: [0x00]
      mask: [0x01]
    command_on:
      data: [0xAC, 0x7A, 0x01, 0x01]
      ack: [0x79, 0x01, 0x01]
    command_off:
      data: [0xAC, 0x7A, 0x01, 0x00]
      ack: [0x79, 0x01, 0x00]
```

### 난방 (Climate)

```yaml
climate:
  - name: 'Room Heater'
    visual:
      min_temperature: 5 °C
      max_temperature: 40 °C
      temperature_step: 1 °C
    state:
      data: [0x7C, 0x01]
    state_temperature_current:
      offset: 4
      length: 1
    state_temperature_target:
      offset: 3
      length: 1
    state_off:
      offset: 2
      data: [0x00]
      mask: [0x01]
    state_heat:
      offset: 2
      data: [0x01]
      mask: [0x01]
    command_off:
      data: [0xAE, 0x7D, 0x01, 0x00, 0x00, 0x00, 0x00]
      ack: [0x7D, 0x01, 0x00]
    command_heat:
      data: [0xAE, 0x7D, 0x01, 0x01, 0x00, 0x00, 0x00]
      ack: [0x7D, 0x01, 0x01]
    command_temperature: >-
      [[0xAE, 0x7F, 0x01, x, 0x00, 0x00, 0x00],[0x7F, 0x01, x]]
    state_action: >-
      data[3] == 0x00 ? 'off' : (data[4] > data[5] ? 'heating' : 'idle')
```

### 가스밸브 (Button)

```yaml
button:
  - name: 'Gas Valve Close'
    icon: 'mdi:gas-burner'
    command_press:
      data: [0xAB, 0x78, 0x00]
      ack: [0x78]
```

### 환기팬 (Fan)

```yaml
fan:
  - name: 'Ventilator'
    state:
      data: [0x4E]
    state_on:
      offset: 3
      data: [0x00]
    state_off:
      offset: 3
      data: [0x01]
    state_speed: >-
      data[1] == 0x03 ? 1 : (data[1] == 0x02 ? 2 : (data[1] == 0x01 ? 3 : 0))
    command_on:
      data: [0xC2, 0x4F, 0x05, 0x00, 0x00]
      ack: [0x4F, 0x05]
    command_off:
      data: [0xC2, 0x4F, 0x06, 0x00, 0x00]
      ack: [0x4F, 0x06]
    command_speed: >-
      [[0xC2, 0x4F, 0x04 - x, 0x00, 0x00],[0x4F, 0x04 - x]]
```

### 엘리베이터 (Automation 활용)

현관스위치를 탈거하고 사용하는 경우, automation을 통해 월패드의 요청에 응답합니다:

```yaml
entities:
  switch:
    - id: 'elevator_call'
      name: 'Elevator Call'
      icon: 'mdi:elevator'
      optimistic: true

automation:
  # 장치스캔 응답
  - id: 'status_response_comm'
    trigger:
      - type: packet
        match:
          data: [0xAD, 0x5A, 0x00, 0x77]
          offset: 0
    then:
      - action: send_packet
        data: [0xB0, 0x5A, 0x00, 0x6A]
        checksum: false

  # 엘리베이터 상태 응답 (호출 중이면 호출됨, 아니면 대기)
  - id: 'status_response_elevator'
    mode: restart
    trigger:
      - type: packet
        match:
          data: [0xAD, 0x41, 0x00, 0x6C]
          offset: 0
    then:
      - action: send_packet
        data: "states['elevator_call']['state'] == 'on' ? [0xB0, 0x2F, 0x01, 0x1E] : [0xB0, 0x41, 0x00, 0x71]"
        checksum: false
      - action: delay
        milliseconds: 20s
      - action: command
        target: id(elevator_call).command_off()

  # 엘리베이터 완료 응답
  - id: 'elevator_call_ack'
    trigger:
      - type: packet
        match:
          data: [0xAD, 0x2F, 0x00, 0x02]
          offset: 0
    then:
      - action: send_packet
        data: [0xB0, 0x41, 0x00, 0x71]
        checksum: false
      - action: command
        target: id(elevator_call).command_off()
```

### 현관벨 자동 문열기 (Doorbell)

현관벨이 울릴 때 자동으로 통화 및 문열기를 수행하는 고급 자동화입니다:

```yaml
entities:
  binary_sensor:
    # 개인현관벨 상태 감지
    - id: 'doorbell_private'
      name: '개인현관벨'
      icon: 'mdi:bell-ring'
      state:
        data: [0x30]
        mask: [0xF0]
      state_on:
        data: [0x31, 0x00]
      state_off:
        data: [0x3E, 0x01]
        mask: [0xFF, 0x01]

  switch:
    # 자동열기 ON/OFF 제어 스위치
    - id: 'doorbell_auto_open_private'
      name: '개인현관벨 자동열기'
      icon: 'mdi:door-open'
      optimistic: true

  text:
    # 상태 머신을 위한 내부 텍스트 엔티티
    - id: 'door_state'
      name: '현관문 상태'
      internal: true      # HA Discovery 및 대시보드에서 숨김
      optimistic: true    # 패킷 없이 상태 관리
      initial_value: 'D_IDLE'

automation:
  # 벨이 울리면 자동열기 시퀀스 시작
  - id: 'doorbell_private_ring'
    mode: restart
    trigger:
      - type: state
        entity_id: doorbell_private
        property: state
        match: 'on'
    then:
      - action: command
        target: id(door_state).command_set('D_BELL')
      - action: if
        condition: "states['doorbell_auto_open_private']['state'] == 'on'"
        then:
          - action: delay
            milliseconds: 2s
          - action: command
            target: id(door_state).command_set('D_CALL')
          - action: delay
            milliseconds: 3s
          - action: command
            target: id(door_state).command_set('D_OPEN')

  # 월패드 쿼리(A4 41)에 상태에 따라 응답
  - id: 'response_query'
    trigger:
      - type: packet
        match:
          data: [0xA4, 0x41]
          mask: [0xFF, 0xFF]
          offset: 0
    then:
      - action: if
        condition: "states['door_state']['state'] == 'D_CALL'"
        then:
          - action: send_packet
            data: [0xB0, 0x36, 0x01]  # 개인현관 통화
            checksum: true
        else:
          - action: if
            condition: "states['door_state']['state'] == 'D_OPEN'"
            then:
              - action: send_packet
                data: [0xB0, 0x3B, 0x00]  # 개인현관 문열기
                checksum: true
            else:
              - action: send_packet
                data: [0xB0, 0x41, 0x00]  # 대기 상태
                checksum: true
```

**사용 방법:**
1. `doorbell_auto_open_private` 스위치를 ON으로 설정
2. 개인현관벨이 울리면 자동으로:
   - 2초 후 통화 (`0xB0 0x36 0x01`)
   - 3초 후 문열기 (`0xB0 0x3B 0x00`)

> 💡 전체 설정은 [`gallery/samsung_sds/doorbell.yaml`](../../gallery/samsung_sds/doorbell.yaml)을 참조하세요.