# 엔티티 설정 예제

이 문서는 homenet2mqtt에서 지원하는 다양한 엔티티 타입의 설정 예제를 제공합니다.

## 목차
- [Lock Entity](#lock-entity)
- [Number Entity](#number-entity)
- [Select Entity](#select-entity)
- [Text Sensor Entity](#text-sensor-entity)
- [Text Entity](#text-entity)
- [Climate Entity (확장)](#climate-entity-확장)
- [Light Entity (확장)](#light-entity-확장)
- [Fan Entity (확장)](#fan-entity-확장)
- [Valve Entity (확장)](#valve-entity-확장)

---

## Lock Entity

도어 잠금장치, 전자키 등을 제어합니다.

### 기본 예제
```yaml
lock:
  - id: front_door
    name: "현관 도어락"
    state:
      offset: 0
      data: [0xA0]
    state_locked:
      offset: 1
      data: [0x01]
    state_unlocked:
      offset: 1
      data: [0x00]
    command_lock:
      data: [0xA0, 0x01]
    command_unlock:
      data: [0xA0, 0x00]
```

### 고급 기능 (상태 추가)
```yaml
lock:
  - id: entrance_gate
    name: "출입문"
    state:
      offset: 0
      data: [0xA1]
    state_locked:
      offset: 1
      data: [0x01]
    state_unlocked:
      offset: 1
      data: [0x00]
    state_locking:
      offset: 1
      data: [0x02]
    state_unlocking:
      offset: 1
      data: [0x03]
    state_jammed:
      offset: 1
      data: [0xFF]
    command_lock:
      data: [0xA1, 0x01]
    command_unlock:
      data: [0xA1, 0x00]
```

**지원하는 상태:**
- `LOCKED`: 잠금
- `UNLOCKED`: 해제
- `LOCKING`: 잠금 중
- `UNLOCKING`: 해제 중
- `JAMMED`: 걸림

---

## Number Entity

숫자 입력을 받는 엔티티입니다. 온도 설정, 타이머 등에 사용합니다.

### 기본 예제
```yaml
number:
  - id: temp_setpoint
    name: "온도 설정값"
    state:
      offset: 0
      data: [0xB0]
    state_number:
      offset: 1
      length: 1
    min_value: 15
    max_value: 30
    step: 0.5
    command_number:
      data: [0xB0, 0x00]
      value_offset: 1
      length: 1
```

### Precision 사용 예제
```yaml
number:
  - id: humidity_target
    name: "목표 습도"
    state:
      offset: 0
      data: [0xB1]
    state_number:
      offset: 1
      length: 1
      precision: 0  # 소수점 없음
    min_value: 30
    max_value: 80
    step: 5
    command_number:
      data: [0xB1, 0x00]
      value_offset: 1
```

### Multi-byte 값 예제
```yaml
number:
  - id: timer_minutes
    name: "타이머 (분)"
    state:
      offset: 0
      data: [0xB2]
    state_number:
      offset: 1
      length: 2  # 2바이트 (0-65535)
      endian: big
    min_value: 0
    max_value: 1440  # 24시간
    step: 1
    command_number:
      data: [0xB2, 0x00, 0x00]
      value_offset: 1
      length: 2
```

---

## Select Entity

드롭다운 옵션을 선택하는 엔티티입니다.

### 기본 예제
```yaml
select:
  - id: fan_mode
    name: "팬 모드"
    state:
      offset: 0
      data: [0xC0]
    options:
      - "자동"
      - "약풍"
      - "강풍"
      - "절전"
    initial_option: "자동"
    command_select:
      data: [0xC0, 0x00]
```

### 상태 파싱을 위한 CEL 예제
```yaml
select:
  - id: operation_mode
    name: "동작 모드"
    state:
      offset: 0
      data: [0xC1]
    options:
      - "OFF"
      - "ON"
      - "AUTO"
      - "MANUAL"
    state_select: >-
      data[1] == 0x00 ? "OFF" :
      (data[1] == 0x01 ? "ON" :
      (data[1] == 0x02 ? "AUTO" :
      (data[1] == 0x03 ? "MANUAL" : "OFF")))
    command_select:
      data: [0xC1, 0x00]
```

---

## Text Sensor Entity

읽기 전용 텍스트 값을 표시하는 엔티티입니다. 상태 표시, 에러 메시지 등에 사용합니다.

### 기본 예제
```yaml
text_sensor:
  - id: device_status
    name: "기기 상태"
    state:
      offset: 0
      data: [0xD0]
    state_text:
      offset: 1
      length: 16  # 최대 16바이트 ASCII
```

### 짧은 메시지 예제
```yaml
text_sensor:
  - id: error_code
    name: "에러 코드"
    state:
      offset: 0
      data: [0xD1]
    state_text:
      offset: 1
      length: 4  # 4자 코드
```

**참고:**
- ASCII 문자 (0x20-0x7E)만 추출됩니다.
- null terminator (0x00)를 만나면 문자열이 종료됩니다.
- 제어 문자는 자동으로 필터링됩니다.

---

## Text Entity

텍스트 입력이 가능한 엔티티입니다. 이름 설정, 메모 등에 사용합니다.

### 기본 예제
```yaml
text:
  - id: device_name
    name: "기기 이름"
    state:
      offset: 0
      data: [0xE0]
    state_text:
      offset: 1
      length: 16
    min_length: 1
    max_length: 16
    command_text:
      data: [0xE0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
      value_offset: 1
      length: 16
```

### Password 모드 예제
```yaml
text:
  - id: door_pin
    name: "출입 비밀번호"
    state:
      offset: 0
      data: [0xE1]
    state_text:
      offset: 1
      length: 8
    min_length: 4
    max_length: 8
    mode: password
    pattern: "^[0-9]+$"  # 숫자만 허용
    command_text:
      data: [0xE1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
      value_offset: 1
      length: 8
```

**참고:**
- 입력 텍스트는 ASCII로 변환되어 전송됩니다.
- 짧은 텍스트는 null 바이트로 패딩됩니다.
- 긴 텍스트는 max_length까지 잘립니다.

---

## Climate Entity (확장)

온도 조절기, 에어컨, 히터 등을 제어합니다. 기존 기능에 습도, 팬, 스윙, 프리셋이 추가되었습니다.

### 기본 예제
```yaml
climate:
  - id: living_room_ac
    name: "거실 에어컨"
    state:
      offset: 0
      data: [0x20]
    state_on:
      offset: 1
      data: [0x01]
    state_off:
      offset: 1
      data: [0x00]
    state_heat:
      offset: 2
      data: [0x01]
    state_cool:
      offset: 2
      data: [0x02]
    state_temperature:
      offset: 3
      length: 1
    command_on:
      data: [0x20, 0x01]
    command_off:
      data: [0x20, 0x00]
    command_heat:
      data: [0x20, 0x01, 0x01]
    command_cool:
      data: [0x20, 0x01, 0x02]
    command_temperature:
      data: [0x20, 0x01, 0x00, 0x00]
      value_offset: 3
```

### 고급 기능 (습도, 팬, 스윙, 프리셋)
```yaml
climate:
  - id: bedroom_ac
    name: "침실 에어컨"
    state:
      offset: 0
      data: [0x21]
    
    # 기본 모드
    state_off: { offset: 1, data: [0x00] }
    state_heat: { offset: 1, data: [0x01] }
    state_cool: { offset: 1, data: [0x02] }
    state_fan_only: { offset: 1, data: [0x03] }
    state_dry: { offset: 1, data: [0x04] }
    state_auto: { offset: 1, data: [0x05] }
    
    # 온도
    state_temperature: { offset: 2, length: 1 }
    command_temperature:
      data: [0x21, 0x00, 0x00]
      value_offset: 2
    
    # 습도
    state_humidity_current: { offset: 3, length: 1 }
    state_humidity_target: { offset: 4, length: 1 }
    command_humidity:
      data: [0x21, 0x00, 0x00, 0x00, 0x00]
      value_offset: 4
    
    # 스윙 모드
    state_swing_off: { offset: 5, data: [0x00] }
    state_swing_vertical: { offset: 5, data: [0x01] }
    state_swing_horizontal: { offset: 5, data: [0x02] }
    state_swing_both: { offset: 5, data: [0x03] }
    command_swing:
      data: [0x21, 0x00, 0x00, 0x00, 0x00, 0x00]
      value_offset: 5
    
    # 팬 모드
    state_fan_auto: { offset: 6, data: [0x00] }
    state_fan_low: { offset: 6, data: [0x01] }
    state_fan_medium: { offset: 6, data: [0x02] }
    state_fan_high: { offset: 6, data: [0x03] }
    command_fan:
      data: [0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
      value_offset: 6
    
    # 프리셋 모드
    state_preset_none: { offset: 7, data: [0x00] }
    state_preset_eco: { offset: 7, data: [0x01] }
    state_preset_sleep: { offset: 7, data: [0x02] }
    state_preset_boost: { offset: 7, data: [0x03] }
    command_preset:
      data: [0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
      value_offset: 7
```

**지원하는 기능:**
- **모드**: off, heat, cool, fan_only, dry, auto
- **습도**: 현재/목표 습도
- **스윙**: off, vertical, horizontal, both
- **팬**: auto, low, medium, high, quiet
- **프리셋**: none, eco, sleep, boost, comfort, home, away, activity

---

## Light Entity (확장)

조명을 제어합니다. 기존 ON/OFF에 밝기, 색온도, RGB 색상 기능이 추가되었습니다.

### 밝기 조절 예제
```yaml
light:
  - id: living_room_light
    name: "거실 조명"
    state:
      offset: 0
      data: [0x30]
    state_on:
      offset: 1
      data: [0x01]
    state_off:
      offset: 1
      data: [0x00]
    state_brightness:
      offset: 2
      length: 1  # 0-255
    command_on:
      data: [0x30, 0x01]
    command_off:
      data: [0x30, 0x00]
    command_brightness:
      data: [0x30, 0x01, 0x00]
      value_offset: 2
```

### RGB 색상 제어
```yaml
light:
  - id: rgb_strip
    name: "RGB 조명"
    state:
      offset: 0
      data: [0x31]
    state_on: { offset: 1, data: [0x01] }
    state_off: { offset: 1, data: [0x00] }
    
    # RGB 색상
    state_red: { offset: 2, length: 1 }
    state_green: { offset: 3, length: 1 }
    state_blue: { offset: 4, length: 1 }
    
    command_on: { data: [0x31, 0x01] }
    command_off: { data: [0x31, 0x00] }
    command_red:
      data: [0x31, 0x01, 0x00, 0x00, 0x00]
      value_offset: 2
    command_green:
      data: [0x31, 0x01, 0x00, 0x00, 0x00]
      value_offset: 3
    command_blue:
      data: [0x31, 0x01, 0x00, 0x00, 0x00]
      value_offset: 4
```

### 색온도 제어
```yaml
light:
  - id: white_light
    name: "백색 조명"
    state:
      offset: 0
      data: [0x32]
    state_on: { offset: 1, data: [0x01] }
    state_off: { offset: 1, data: [0x00] }
    state_brightness: { offset: 2, length: 1 }
    state_color_temp: { offset: 3, length: 2 }  # mireds
    
    min_mireds: 153  # 6500K (차가운 백색)
    max_mireds: 500  # 2000K (따뜻한 백색)
    
    command_on: { data: [0x32, 0x01] }
    command_off: { data: [0x32, 0x00] }
    command_brightness:
      data: [0x32, 0x01, 0x00]
      value_offset: 2
    command_color_temp:
      data: [0x32, 0x01, 0x00, 0x00, 0x00]
      value_offset: 3
      length: 2
```

**지원하는 기능:**
- **Brightness**: 0-255
- **RGB Color**: Red, Green, Blue (각 0-255)
- **Color Temperature**: mireds 단위
- **White Value**: 백색 채널
- **Effects**: 이펙트 리스트

---

## Fan Entity (확장)

팬, 환풍기, 공기청정기 등을 제어합니다. 프리셋, 회전, 방향 기능이 추가되었습니다.

### 기본 + 속도 제어
```yaml
fan:
  - id: ceiling_fan
    name: "천장 선풍기"
    state:
      offset: 0
      data: [0x40]
    state_on: { offset: 1, data: [0x01] }
    state_off: { offset: 1, data: [0x00] }
    state_speed:
      offset: 2
      length: 1  # 0-100%
    command_on: { data: [0x40, 0x01] }
    command_off: { data: [0x40, 0x00] }
    command_speed:
      data: [0x40, 0x01, 0x00]
      value_offset: 2
```

### 고급 기능 (프리셋, 회전, 방향)
```yaml
fan:
  - id: air_purifier
    name: "공기청정기"
    state:
      offset: 0
      data: [0x41]
    state_on: { offset: 1, data: [0x01] }
    state_off: { offset: 1, data: [0x00] }
    
    # 속도
    state_percentage: { offset: 2, length: 1 }
    command_percentage:
      data: [0x41, 0x01, 0x00]
      value_offset: 2
    
    # 프리셋 모드
    preset_modes:
      - "자동"
      - "절전"
      - "터보"
      - "취침"
    state_preset_mode: { offset: 3, data: [0x00] }  # CEL로 파싱
    command_preset_mode:
      data: [0x41, 0x01, 0x00, 0x00]
      value_offset: 3
    
    # 회전 (좌우)
    state_oscillating: { offset: 4, data: [0x01] }
    command_oscillating:
      data: [0x41, 0x01, 0x00, 0x00, 0x00]
      value_offset: 4
    
    # 방향
    state_direction: { offset: 5, data: [0x00] }  # 0=forward, 1=reverse
    command_direction:
      data: [0x41, 0x01, 0x00, 0x00, 0x00, 0x00]
      value_offset: 5
```

**지원하는 기능:**
- **Speed/Percentage**: 0-100%
- **Preset Modes**: 사용자 정의 프리셋
- **Oscillation**: 회전 ON/OFF
- **Direction**: Forward/Reverse

---

## Valve Entity (확장)

밸브, 블라인드, 커튼 등을 제어합니다. 위치 제어와 정지 기능이 추가되었습니다.

### 기본 Open/Close
```yaml
valve:
  - id: water_valve
    name: "급수 밸브"
    state:
      offset: 0
      data: [0x50]
    state_open: { offset: 1, data: [0x01] }
    state_closed: { offset: 1, data: [0x00] }
    command_open: { data: [0x50, 0x01] }
    command_close: { data: [0x50, 0x00] }
```

### 위치 제어 (블라인드)
```yaml
valve:
  - id: living_blind
    name: "거실 블라인드"
    state:
      offset: 0
      data: [0x51]
    state_open: { offset: 1, data: [0x64] }  # 100%
    state_closed: { offset: 1, data: [0x00] }  # 0%
    state_opening: { offset: 2, data: [0x01] }
    state_closing: { offset: 2, data: [0x02] }
    
    # 위치 0-100%
    state_position:
      offset: 1
      length: 1
    command_position:
      data: [0x51, 0x00]
      value_offset: 1
    
    # 정지
    command_stop: { data: [0x51, 0xFF] }
    
    reports_position: true
    
    command_open: { data: [0x51, 0x64] }
    command_close: { data: [0x51, 0x00] }
```

**지원하는 기능:**
- **Position**: 0-100% (0=닫힘, 100=열림)
- **Transitional States**: opening, closing
- **Stop Command**: 동작 중지

---

## 참고 사항

### CEL 표현식
일부 고급 기능은 CEL (Common Expression Language) 표현식을 사용하여 커스텀 로직을 구현할 수 있습니다:

```yaml
state_select: >-
  // data 배열에서 값을 읽어 옵션 문자열 반환
  data[1] == 0x00 ? "OFF" :
  (data[1] == 0x01 ? "ON" : "UNKNOWN")
```

### 바이트 순서 (Endianness)
multi-byte 값을 사용할 때 엔디안을 지정할 수 있습니다:

```yaml
state_number:
  offset: 1
  length: 2
  endian: big  # 또는 little
```

### Precision (소수점)
숫자 값에 소수점을 적용할 수 있습니다:

```yaml
state_number:
  offset: 1
  length: 1
  precision: 1  # 값 / 10 (예: 235 -> 23.5)
```

더 자세한 정보는 [README.md](../README.md)를 참조하세요.
