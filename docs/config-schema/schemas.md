# State/Command 스키마 정의

`StateSchema`, `StateNumSchema`, `CommandSchema`는 모든 엔티티와 자동화에서 공통으로 사용하는 핵심 구조입니다. 값 추출과 명령 생성의 기준이 되므로 다른 문서를 읽기 전에 이 정의를 확인하세요.

## 패킷 매칭과 상태 추출의 분리
설정 파일에서 `state`와 `state_*` 필드는 서로 다른 역할을 수행합니다.

### 1. `state` (패킷 매칭)
- **역할**: 들어오는 수많은 RS485 패킷 중, **이 엔티티가 처리해야 할 패킷을 선별**합니다.
- **사용 스키마**: `StateSchema`
- **동작**: 이 조건에 맞는 패킷만 다음 단계(상태 추출)로 넘어갑니다.

### 2. `state_*` (상태 추출)
- **역할**: 매칭된 패킷에서 **실제 엔티티의 상태(ON/OFF, 온도 값 등)를 추출**합니다.
- **사용 스키마**: `StateSchema` 또는 `StateNumSchema`, `CEL`
- **동작**: `state`에서 매칭된 패킷 데이터를 기반으로 값을 읽어냅니다.

---

## StateSchema (패킷 매칭)
패킷을 필터링(`state`)하거나 단순 상태(`state_on/off`)를 정의할 때 사용합니다.

| 속성 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `data` | `number[]` | - | 패킷이 이 배열과 일치해야 합니다. |
| `offset` | `number` | `rx_header`의 길이 | `data` 비교를 시작할 위치입니다. **생략 시 헤더 다음 바이트부터 매칭하고, 명시(0 포함) 시 헤더 포함 전체 패킷 기준 인덱스**입니다. |
| `mask` | `number` \| `number[]` | - | 비교 전 `(value & mask)`를 적용합니다. 특정 비트만 비교할 때 유용합니다. |
| `inverted` | `boolean` | `false` | `true`면 매칭/추출 전에 비트를 반전(`~value`)합니다. |
| `guard` | `string` | - | `data` 매칭 후 추가로 검증할 CEL 표현식입니다. |
| `except` | `StateSchema[]` | - | 이 패턴에 매칭되면 무시합니다 (예외 처리). |

### 실전 작성 가이드

**Q: 헤더 다음 바이트가 `0x82 0x80 0x01`로 시작하는 패킷을 매칭하려면?**
`offset`을 생략하면 헤더 다음 바이트부터 매칭합니다.
```yaml
# rx_header: [0xF7]인 경우 → F7 82 80 01 ... 매칭
state:
  data: [0x82, 0x80, 0x01]
```

**Q: 헤더를 포함한 전체 패킷의 3번째 바이트(인덱스 2)가 `0x01`인 패킷은?**
`offset`을 명시하면 헤더 포함 전체 패킷 기준으로 인덱스를 지정합니다.
```yaml
# rx_header: [0xF7]인 경우 → F7 xx 01 ... 매칭 (packet[2] = 0x01)
state:
  offset: 2
  data: [0x01]
```

**Q: 특정 위치의 상위 4비트만 확인하고 싶다면?**
`mask`를 사용하여 하위 비트를 무시합니다. (예: `0x3?` 형태 매칭)
```yaml
state:
  data: [0x30]      # 0x30 ~ 0x3F 모두 매칭됨 (마스크 적용 후 0x30이 되는 값)
  mask: [0xF0]      # 상위 4비트만 비교
```

**Q: 특정 패킷은 제외하고 싶다면?**
`except`를 사용하여 예외 조건을 추가합니다.
```yaml
state:
  data: [0x82]
  except:
    - offset: 1
      data: [0xEE]  # 0x82 0xEE ... 는 제외
```

---

## StateNumSchema (상태 값 추출)
`StateSchema`의 확장이며 패킷에서 추출한 값의 변환이 필요할때 사용하는 스키마입니다. `StateSchema`의 모든 속성을 사용할 수 있으며 아래의 `StateNumSchema` 전용 속성을 사용하면 `StateNumSchema`로 평가됩니다.

| 속성 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `length` | `number` | `1` | 읽을 바이트 길이. |
| `endian` | `'big'` \| `'little'` | `'big'` | 다바이트일 때 바이트 순서. |
| `signed` | `boolean` | `false` | 부호 있는 정수로 해석할지 여부. |
| `precision` | `number` | `0` | 소수점 자리수. `precision: 1`이면 `123` → `12.3`. |
| `decode` | `DecodeEncodeType` | `'none'` | `bcd`, `ascii`, `signed_byte_half_degree` 등. |
| `mapping` | `Object` | - | `{ 원시값: 결과 }` 형태로 값을 치환 (예: `{0: "Off", 1: "On"}`). |

### 활용 예시

**1. 3번째 바이트를 온도로 읽기**
```yaml
# 먼저 패킷을 매칭
state:
  data: [0x82, 0x80]

# 매칭된 패킷의 2번 인덱스(3번째 바이트)를 온도로 사용
state_temperature:
  offset: 2
  length: 1
```

**2. 16비트 정수 (Big Endian) 읽기 + 소수점**
오프셋 4부터 2바이트를 읽어 `23.5`(`235`)로 변환합니다.
```yaml
state_temperature:
  offset: 4
  length: 2
  endian: big
  precision: 1
```

**3. BCD 포맷 디코딩**
`0x12 0x34` → `1234`로 변환.
```yaml
state_value:
  offset: 5
  length: 2
  decode: bcd
```

## CommandSchema
명령 패킷 정의에 사용합니다. **스키마 기반 정의** 또는 **CEL 표현식(문자열)**으로 작성할 수 있습니다.

| 속성 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `data` | `number[]` | - | 전송할 기본 패킷 데이터. |
| `ack` | `StateSchema` \| `number[]` | - | ACK 패킷 매칭 패턴. 정의된 경우 이 패턴에 매칭되는 패킷 **또는** `state:change` 이벤트가 발생하면 명령이 성공한 것으로 간주합니다. 배열로 지정하면 `{ data: [...] }` 형태의 `StateSchema`로 자동 변환됩니다. **`offset`을 생략하면 헤더 다음 바이트부터 매칭하고, `offset`을 명시(0 포함)하면 헤더 포함 전체 패킷 기준으로 매칭**합니다. |

| `value_offset` | `number` | - | 입력값을 삽입할 인덱스. |
| `length` | `number` | `1` | 입력값이 차지할 바이트 길이. |
| `precision` | `number` | `0` | 소수점 자릿수. 예: `precision: 1`이면 `23.5` → `235`로 인코딩. |
| `endian` | `'big'` \| `'little'` | `'big'` | 다바이트 값의 바이트 순서. |
| `signed` | `boolean` | `false` | 부호 있는 정수로 인코딩할지 여부. |
| `value_encode` | `DecodeEncodeType` | `'none'` | `bcd`, `ascii`, `signed_byte_half_degree` 등. |
| `multiply_factor` | `number` | `1` | 값에 곱할 계수. 예: `multiply_factor: 10`이면 `2.5` → `25`. |
| `low_priority` | `boolean` | `false` | `true`면 일반 큐가 비어 있을 때만 전송합니다. (Schedule 트리거 사용 시 기본값 `true`로 강제됨) |
| `script` | `string` | - | 재사용 가능한 스크립트 ID 참조. [SCRIPTS.md](../SCRIPTS.md) 참고. |

### ACK 동작 방식

- **`ack`가 정의된 경우**: ACK 패킷 매칭 **또는** 해당 엔티티의 `state:change` 이벤트 중 **먼저 발생하는 것**을 ACK로 처리합니다.
- **`ack`가 정의되지 않은 경우**: 기존처럼 `state:change` 이벤트만을 ACK로 대기합니다.
- Button과 같이 `state:change` 이벤트가 발생하지 않는 엔티티에서는 `ack`를 반드시 정의해야 ACK를 수신할 수 있습니다.
- `ack`는 위의 [StateSchema](#stateschema-패킷-매칭) 형식으로 정의할 수 있으며, `offset`, `mask`, `except` 등의 고급 매칭 옵션을 사용할 수 있습니다.

### 스키마 기반 vs CEL 방식

| 구분 | 스키마 기반 | CEL 표현식 |
|------|-----------|-----------|
| **형식** | `{ data: [...], value_offset: N }` | 문자열 `"[0x01, int(x)]"` |
| **성능** | 빠름 (직접 연산) | 약간 느림 (파서 오버헤드) |
| **가독성** | 높음 | 복잡한 로직에 적합 |
| **유연성** | 단순 값 삽입 | 조건부/복잡한 로직 가능 |

단순한 값 삽입에는 **스키마 기반**을, 조건부 로직이나 복잡한 바이트 조합에는 **CEL**을 권장합니다.

### 활용 예시

**1. 단순 명령 전송 (Switch ON)**
```yaml
command_on:
  data: [0x31, 0x01]
```

**2. 입력값 포함 명령 (온도 설정)**
사용자가 입력한 `25`라는 값을 패킷의 2번째 위치에 넣어 전송합니다.
```yaml
command_temperature:
  data: [0x21, 0x00]
  value_offset: 1
```

**3. 소수점 처리 (0.5도 단위)**
`23.5`를 `235`로 변환하여 전송합니다.
```yaml
command_temperature:
  data: [0x21, 0x00]
  value_offset: 1
  precision: 1
```

**4. 0.5도 단위 특수 인코딩**
비트 7을 0.5 플래그로 사용하는 방식입니다.
```yaml
command_temperature:
  data: [0x21, 0x00]
  value_offset: 1
  value_encode: signed_byte_half_degree
```

**5. BCD 인코딩 (숫자를 BCD로 변환)**
`1234`를 `0x12 0x34`로 변환하여 전송합니다.
```yaml
command_number:
  data: [0xD1, 0x00, 0x00]
  value_offset: 1
  length: 2
  value_encode: bcd
```

**6. 문자열 인코딩 (ASCII 메시지 전송)**
텍스트를 ASCII 바이트로 변환하여 8바이트 길이에 맞춰 전송합니다.
```yaml
command_text:
  data: [0xD1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
  value_offset: 1
  length: 8
  value_encode: ascii
```

**7. CEL 표현식 (조건부 패킷 생성)**
온도에 따라 다른 명령 코드를 사용합니다.
```yaml
command_temperature: >-
  x > 30 ? [0x21, 0x02, int(x)] : [0x21, 0x01, int(x)]
```

**7-1. CEL 표현식 (ACK 포함)**
중첩 배열로 반환하면 첫 번째 배열이 명령 데이터, 두 번째 배열이 ACK 패턴, (선택) 세 번째 배열이 ACK 마스크입니다.
```yaml
# 2개 배열: [data, ack:data]
command_temperature: >-
  [[0x36, 0x11, 0x44, 0x01, int(x)], [0x36, 0x11, 0xC4]]

# 3개 배열: [data, ack:data, ack:mask]
command_temperature: >-
  [[0x36, 0x11, 0x44, 0x01, int(x)], [0x36, 0x11], [0xFF, 0xFF]]
```
- 첫 번째 배열: 전송할 명령 패킷
- 두 번째 배열: ACK로 인식할 패킷의 data (StateSchema의 `data`)
- 세 번째 배열 (선택): ACK 매칭 시 사용할 mask (StateSchema의 `mask`)

**8. 스크립트 참조 (재사용 가능한 액션 시퀀스)**
`scripts` 블록에서 정의한 스크립트를 참조하여 복잡한 명령 시퀀스를 재사용합니다.
```yaml
# 스크립트 정의
scripts:
  - id: refresh_all
    actions:
      - send: [0x30, 0x91, 0x00, 0x00]
        delay: 100
      - send: [0x30, 0x92, 0x00, 0x00]

# 엔티티에서 스크립트 참조
button:
  - id: refresh_button
    name: "전체 새로고침"
    command_press:
      script: refresh_all
```

**9. ACK 패킷 매칭 (Button 등 state:change 이벤트가 없는 엔티티)**
`ack`를 정의하면 해당 패턴에 매칭되는 패킷을 ACK로 인식합니다.
```yaml
# 간단한 배열 형태 (자동으로 StateSchema로 변환됨)
button:
  - id: elevator_call
    name: "엘리베이터 호출"
    command_press:
      data: [0x31, 0x01, 0x00]
      ack: [0x31, 0x81, 0x00]  # 0x31 0x81 0x00으로 시작하는 패킷을 ACK로 인식

# StateSchema 형태 (offset, mask 등 고급 옵션 사용 가능)
button:
  - id: doorbell
    name: "초인종"
    command_press:
      data: [0x42, 0x01]
      ack:
        data: [0x42]
        offset: 0
        mask: 0xFF
```

## CEL과의 연계
- `state*`, `command*` 필드는 모두 [CEL 가이드](../CEL_GUIDE.md)의 표현식(문자열)으로 대체할 수 있습니다.
- CEL 컨텍스트 변수:
  - `x`: 입력값 (숫자 또는 원시 타입)
  - `xstr`: 입력값의 문자열 버전 (문자열 비교 시 사용)
  - `state`: 현재 엔티티 상태
  - `states`: 전체 엔티티 상태 맵
  - `data`: 수신된 패킷 바이트 배열 (상태 파싱 시)
- ⚠️ **`xstr` 사용 시 주의**: Select, Custom Preset 등 문자열 값을 비교할 때는 `x`가 아닌 `xstr`을 사용합니다.
  ```yaml
  # 잘못된 예시 (x는 숫자 타입일 수 있음)
  command_custom_preset: 'x == "Away" ? [0x01] : [0x02]'
  
  # 올바른 예시
  command_custom_preset: 'xstr == "Away" ? [0x01] : [0x02]'
  ```
- `automation` 트리거/액션에서 패킷 매칭은 `StateSchema` 규칙을, 명령 실행은 `CommandSchema` 규칙을 그대로 따릅니다. 자세한 예제는 [AUTOMATION.md](../AUTOMATION.md)를 참고하세요.
- `automation` 액션에 `update_state`를 사용할 수 있습니다. 패킷 트리거와 조합해 엔티티 상태를 직접 갱신하며, 값은 `StateSchema/StateNumSchema`로 정의합니다. `offset`은 수신된 원본 패킷 전체(rx_header 포함)를 기준으로 계산합니다. 모든 엔티티 타입에서 `parseData`와 동일한 해석을 적용합니다.
- 설정 파일에서는 `automation` 대신 `automations`를 최상위 키로 선언해도 동일하게 동작합니다.
- `update_state`는 대상 엔티티에 정의된 `state_*` 및 해당 속성명만 허용하며, 정의되지 않은 속성은 오류로 처리됩니다.

## Scripts 블록
자동화 액션 배열을 재사용하기 위한 `scripts` 블록을 설정 파일에 추가할 수 있습니다. 정의 방법과 활용 예시는
[SCRIPTS.md](../SCRIPTS.md)를 참고하세요.
