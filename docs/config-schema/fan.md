# Fan 스키마 작성법

환기/공조 팬은 `fan` 엔티티로 정의합니다. `type`은 `fan`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 사용할 수 있습니다.

## 필수 필드
- `state`: 팬 상태를 구분하는 기본 패킷 서명.
- 전원 상태 판단용 `state_on`, `state_off` 중 하나 이상.
- 전원 제어용 `command_on`, `command_off` 중 하나 이상.

## 옵션 필드 (상태)
- 속도(백분율): `state_speed` 또는 `state_percentage` — [`StateNumSchema`](./schemas.md#statenumschema).
- 프리셋: `preset_modes`(문자열 배열), `state_preset_mode` — StateSchema 또는 CEL 표현식.
- 회전: `state_oscillating`(좌우 회전 여부), `state_direction`(정/역회전).

## 옵션 필드 (명령)
- 속도/백분율 설정: `command_speed`, `command_percentage` — 입력값을 오프셋에 삽입하거나 CEL 표현식으로 구성.
- 프리셋 설정: `command_preset_mode` — CommandSchema 또는 CEL 표현식 (문자열 인자 `xstr` 사용).
- 회전 제어: `command_oscillating`, `command_direction`.

## 프리셋 모드 사용법

Fan의 프리셋 모드는 여러 모드 값을 구분해야 하므로 **CEL 표현식**을 사용합니다.

- `preset_modes`: UI에 표시할 프리셋 이름 배열
- `state_preset_mode`: 패킷에서 현재 프리셋을 파싱하는 CEL 표현식 (문자열 반환)
- `command_preset_mode`: 선택된 프리셋에 따라 명령 패킷을 생성하는 CEL 표현식

```yaml
fan:
  - id: ventilator
    preset_modes: ["Auto", "Sleep", "Turbo"]
    
    # 상태 파싱: 패킷 바이트에 따라 문자열 반환
    state_preset_mode: >-
      data[5] == 0x01 ? "Auto" : 
      (data[5] == 0x02 ? "Sleep" : "Turbo")
      
    # 명령 생성: 선택된 문자열(xstr)에 따라 바이트 배열 반환
    command_preset_mode: >-
      xstr == "Auto" ? [0x30, 0x71, 0x01, 0x12, 0x01] : 
      (xstr == "Sleep" ? [0x30, 0x71, 0x01, 0x12, 0x02] : 
      [0x30, 0x71, 0x01, 0x12, 0x03])
```

**CEL 사용 시 주의사항:**
- **상태(`state_preset_mode`)**: 패킷(`data`)을 분석하여 `preset_modes`에 정의한 문자열 중 하나를 반환해야 합니다.
- **명령(`command_preset_mode`)**: 사용자가 UI에서 선택한 문자열(`xstr`)을 인자로 받아 바이트 배열을 반환해야 합니다.
  - ⚠️ 문자열 비교 시 `x`가 아닌 **`xstr`** 변수를 사용합니다. (예: `xstr == "Turbo"`)

## 예제: 속도 제어
`cvnet.homenet_bridge.yaml`은 온/오프 패킷과 별도로 `command_speed`에서 목표 속도(`x`)를 삽입하고, `state_speed`로 현재 속도를 읽습니다.

```yaml
fan:
  - id: fan_1
    name: "Fan 1"
    state:
      data: [0x20, 0x01, 0x71]
    state_on:
      offset: 4
      data: [0x01]
    state_off:
      offset: 4
      data: [0x00]
    command_on:
      data: [0x20, 0x71, 0x01, 0x11, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]
    command_off:
      data: [0x20, 0x71, 0x01, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    command_speed: >-
      [[0x20, 0x71, 0x01, 0x11, 0x01, 0x01, x, 0x00, 0x00, 0x00, 0x00, 0x00], [0x20, 0x01, 0x71, 0x91]]
    state_speed:
      offset: 6
```

## 예제: 프리셋 모드 (CEL)
장치가 '자동/수면/터보' 모드를 지원할 때의 설정입니다.

```yaml
fan:
  - id: ventilator
    name: "환기 팬"
    state:
      data: [0x30, 0x01, 0x71]
    state_on:
      offset: 4
      data: [0x01]
    state_off:
      offset: 4
      data: [0x00]
    command_on:
      data: [0x30, 0x71, 0x01, 0x11, 0x01]
    command_off:
      data: [0x30, 0x71, 0x01, 0x11, 0x00]
    
    # 프리셋 이름 정의
    preset_modes: ["Auto", "Sleep", "Turbo"]
    
    # 상태 파싱: 5번 바이트에 따라 문자열 반환
    state_preset_mode: >-
      data[5] == 0x01 ? "Auto" : 
      (data[5] == 0x02 ? "Sleep" : "Turbo")
      
    # 명령 생성: 선택된 문자열(xstr)에 따라 패킷 데이터 생성
    command_preset_mode: >-
      xstr == "Auto" ? [0x30, 0x71, 0x01, 0x12, 0x01] : 
      (xstr == "Sleep" ? [0x30, 0x71, 0x01, 0x12, 0x02] : 
      [0x30, 0x71, 0x01, 0x12, 0x03])
```

## 작성 체크리스트
1. 속도 값 단위가 퍼센트인지 단계형(1~3단)인지 장비별로 확인하고 `value_encode`나 매핑을 맞춥니다.
2. 프리셋 모드를 쓸 경우 `preset_modes` 배열을 정의해야 UI에서 선택할 수 있습니다.
3. 회전/방향과 속도 명령이 한 패킷에 묶인 장비는 CEL 표현식으로 여러 값을 삽입한 다중 패킷을 조립합니다.
4. 프리셋 명령에서 문자열 비교 시 **`xstr`** 변수를 사용합니다.
