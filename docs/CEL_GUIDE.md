# 홈넷 브리지 CEL (Common Expression Language) 가이드

홈넷 브리지 시스템은 기존의 `!lambda` 대신 구글의 **CEL (Common Expression Language)**을 도입하여 더욱 안전하고 간결한 로직 처리를 지원합니다. YAML 설정 파일 내에서 문자열 형태로 표현식을 작성하여 복잡한 상태 파싱이나 동적 명령 생성을 수행할 수 있습니다.

## CEL 도입 배경

기존의 `!lambda`는 자바스크립트 코드를 직접 실행하는 방식으로 유연성은 높았으나, 보안 및 실행 환경 관리 측면에서 복잡함이 있었습니다. CEL은 안전하게 샌드박싱된 환경에서 수식을 평가하며, 빠르고 직관적인 문법을 제공합니다.

## 사용 방법

YAML 파일에서 `state_value`, `command_temperature` 등의 속성에 CEL 표현식을 문자열로 작성합니다. 

### 기본 문법

*   **산술 연산**: `+`, `-`, `*`, `/`, `%`
*   **비교 연산**: `==`, `!=`, `<`, `<=`, `>`, `>=`
*   **논리 연산**: `&&`, `||`, `!`
*   **삼항 연산**: `condition ? true_val : false_val`
*   **괄호**: `( )`를 사용하여 연산 우선순위 지정

## 실행 컨텍스트 (변수)

사용하는 위치에 따라 접근 가능한 변수가 다릅니다.

### 1. 상태 추출 (`state_value`, `state_select` 등)

장치로부터 수신한 패킷 데이터를 분석하여 상태 값을 반환할 때 사용합니다.

*   `data`: 수신된 패킷 데이터의 바이트 배열 (List of int). 예: `data[4]`
*   `state`: 해당 장치의 현재 상태 맵 (Map). 키 이름은 `state_` 접두사를 제거한 값입니다. 예: `state_value` → `state['value']`, `state_temperature_target` → `state['temperature_target']`. `state['value']`는 이전 값이 없으면 `null`입니다.
*   `states`: 전체 엔티티의 상태 맵 (Map). 예: `states['entity_id']['value']` (안전하게 사용하려면 `get_from_states('entity_id', 'value')` 권장)

### 2. 명령 생성 (`command_*`)

사용자의 요청(MQTT 등)을 RS-485 패킷으로 변환할 때 사용합니다.

*   `x`: 명령과 함께 전달된 **숫자** 값 (설정 온도, 팬 속도 등). 예: `x * 10`
*   `xstr`: 명령과 함께 전달된 **문자열** 값 (커스텀 팬 모드, 프리셋 이름 등). 예: `xstr == "Turbo" ? [0x01] : [0x00]`
*   `state`: 해당 장치의 현재 상태 맵 (Map).
*   `states`: 전체 엔티티의 상태 맵 (Map).

### 3. 자동화 (Automation `guard`)

자동화 실행 여부를 결정하는 조건식에서 사용합니다.

*   `states`: 전체 엔티티의 상태 맵 (Map). `states['entity_id']['property']` 형태로 접근 가능합니다. (안전하게 사용하려면 `get_from_states('entity_id', 'property')` 권장)
*   `trigger`: 자동화를 유발한 트리거 정보 (Map).
    *   `trigger.type`: 트리거 유형 (`state`, `packet`, `schedule`, `startup` 등)
    *   `trigger.state`: (state 트리거인 경우) 변경된 상태 맵
    *   `trigger.packet`: (packet 트리거인 경우) 수신된 패킷 배열 (List of int)

## 헬퍼 함수

홈넷 환경에 필요한 비트 연산 및 BCD 변환 함수를 제공합니다.

*   `bcd_to_int(int)`: BCD 포맷을 정수로 변환 (예: `0x12` -> `12`)
*   `int_to_bcd(int)`: 정수를 BCD 포맷으로 변환 (예: `12` -> `0x12`)
*   `bitAnd(int, int)`: 비트 AND 연산 (`&`)
*   `bitOr(int, int)`: 비트 OR 연산 (`|`)
*   `bitXor(int, int)`: 비트 XOR 연산 (`^`)
*   `bitNot(int)`: 비트 NOT 연산 (`~`)
*   `bitShiftLeft(int, int)`: 비트 왼쪽 시프트 (`<<`)
*   `bitShiftRight(int, int)`: 비트 오른쪽 시프트 (`>>`)
*   `double(value)`: 값을 실수형(double)으로 변환 (나눗셈 등을 위해 사용)
*   `has(expr)`: 선택적 필드 존재 여부 확인 (예: `get_from_state('value') != null`)
*   `get_from_states(entity_id, attribute, default?)`: `states` 맵에서 엔티티/속성 값을 안전하게 조회 (없으면 `null`, 기본값을 넘기면 해당 값 반환)
*   `get_from_state(attribute, default?)`: 현재 `state` 맵에서 속성을 안전하게 조회 (없으면 `null`, 기본값을 넘기면 해당 값 반환)

> **Tip**: `states['id']['field']`나 `state['field']`처럼 직접 접근하면 키가 없을 때 오류가 날 수 있습니다. 조건 분기나 기본값 처리가 필요하다면 `get_from_states`, `get_from_state`를 사용하는 편이 안전합니다.

## 사용 예시 (Config Examples)

### 1. 전력량 측정 (Commax 스마트 플러그)

여러 바이트에 나눠진 BCD 데이터를 정수로 변환하고 합산하여 전력량(Watt)을 계산합니다.

```yaml
sensor:
  - id: 'plug_1_power'
    # ...
    state_value: >-
      double((bcd_to_int(data[4]) * 10000) + (bcd_to_int(data[5]) * 100) + bcd_to_int(data[6])) * 0.1
```

### 2. 온도 설정 명령 생성 (Commax 난방)

사용자가 설정한 온도(`x`)를 BCD로 변환하여 명령 패킷에 삽입합니다.

```yaml
climate:
  - id: 'heater_1'
    # ...
    command_temperature: >-
      [[0x04, 0x01, 0x03, int_to_bcd(x), 0x00, 0x00, 0x00], [0x84, 0x00, 0x01]]
```

### 3. 팬 속도 제어 (Hyundai Imazu - 복합 조건문)

입력받은 속도 값(`x`)에 따라 서로 다른 패킷을 생성합니다. 삼항 연산자를 중첩하여 사용한 예시입니다.

```yaml
fan:
  - id: 'fan_1'
    # ...
    command_speed: >-
      x == 3 ? [[0x0b, 0x01, 0x2b, 0x02, 0x40, 0x11, 0x01, 0x00], [0x0c, 0x01, 0x2b, 0x04, 0x40, 0x11, 0x01, 0x01, 0x07]] :
      (x == 2 ? [[0x0b, 0x01, 0x2b, 0x02, 0x42, 0x11, 0x03, 0x00], [0x0c, 0x01, 0x2b, 0x04, 0x40, 0x11, 0x01, 0x01, 0x03]] :
      (x == 1 ? [[0x0b, 0x01, 0x2b, 0x02, 0x42, 0x11, 0x01, 0x00], [0x0c, 0x01, 0x2b, 0x04, 0x40, 0x11, 0x01, 0x01, 0x01]] :
      []))
```

### 4. 조건부 상태 매핑 (삼항 연산자)

특정 바이트의 값에 따라 문자열 상태를 반환합니다.

```yaml
fan:
  - id: 'fan_1'
    # ...
    state_preset: >-
      data[1] == 0x02 ? "Auto" : (data[1] == 0x06 ? "Night" : "")
```

### 5. 이전 상태 유지 (현재 상태 참조)

패킷의 특정 조건이 만족될 때만 기존 값을 유지하도록 구성할 수 있습니다.

```yaml
sensor:
  - id: 'meter_1'
    # ...
    state_value: >-
      data[1] == 0x01 && get_from_state('value') != null ? get_from_state('value') : ""
```

### 6. 체크섬 계산 (`rx_checksum`, `tx_checksum`)

`rx_checksum` (수신) 및 `tx_checksum` (송신) 속성에 표준 알고리즘(`add`, `xor` 등) 대신 CEL 표현식을 사용하여 커스텀 체크섬 로직을 구현할 수 있습니다.

> **주의**: CEL에서는 반복문(`for`, `while`)을 사용할 수 없으므로, 가변 길이 데이터의 전체 합계(Sum)를 구하는 등의 로직은 구현할 수 없습니다. 고정 길이 패킷이나 특정 바이트를 참조하는 로직에 적합합니다.

#### 수신 체크섬 (`rx_checksum`)
수신된 패킷의 유효성을 검증할 때 사용합니다. 표현식의 결과값은 패킷의 체크섬 바이트와 비교됩니다.

*   `data`: 체크섬을 제외한 전체 패킷(헤더 포함) 데이터 배열 (List of int).
*   `len`: 데이터의 길이 (int).

#### 송신 체크섬 (`tx_checksum`)
명령 패킷을 생성하여 전송하기 직전에 계산됩니다. 표현식의 결과값이 체크섬 바이트로 패킷 끝에 추가됩니다.

*   `data`: 헤더와 명령 데이터를 포함한 배열 (List of int).
*   `len`: 전체 데이터 길이 (int).

### 7. 동적 패킷 길이 (`rx_length_expr`)

가변 길이 패킷에서 헤더 다음에 오는 특정 바이트가 길이를 나타내는 경우 사용합니다.

*   `data`: 현재 수신 버퍼의 데이터 배열 (List of int). `data[0]`은 헤더의 첫 바이트(또는 스캔 시작점)입니다.
*   `len`: 현재 수신 버퍼에 남아있는 데이터의 길이 (int).

**예시:**

```yaml
packet_defaults:
  # [수신] 3번째 바이트(인덱스 2) 값을 그대로 체크섬으로 사용
  rx_checksum: "data[2]"

  # [송신] 첫 번째 바이트와 두 번째 바이트를 XOR 연산
  tx_checksum: "bitXor(data[0], data[1])"
```

## CEL 분석기 (UI)

분석 페이지에 있는 **CEL 분석기 카드**에서 표현식과 컨텍스트 값을 입력해 즉시 결과를 확인할 수 있습니다.

*   **위치**: UI → 분석(Analysis) 페이지
*   **입력값**: `expression`, `data`, `x`, `xstr`, `state`, `states`, `trigger`
*   **주의**: 입력값은 JSON 형식으로 작성해야 하며, `data`는 `0x` 16진수 배열도 지원합니다. `xstr`가 있으면 문자열 입력으로 처리됩니다. 평가 실패 시 오류 메시지가 표시됩니다.

## 자주 발생하는 문제와 팁 (Troubleshooting)

### 리스트 내 타입 혼용 오류 (`List elements must have the same type`)

CEL에서 리스트(배열)를 생성할 때, 모든 요소는 동일한 타입이어야 합니다. `0x02`와 같은 숫자는 `int` 타입이지만, `get_from_states('...', 'value')` 같은 맵 접근이나 일부 함수의 반환값은 `dyn` (동적) 타입으로 추론될 수 있습니다.

이 경우 `int(...)`를 사용하여 명시적으로 타입을 변환(캐스팅)해주어야 합니다.

**❌ 잘못된 예시 (오류 발생)**
```yaml
# 0x02는 int, get_from_states('light_1', 'value')는 dyn 타입이므로 오류 발생
command_on:
  - action: send_packet
    data: "[0x02, 0x80, get_from_states('light_1', 'value')]"
```

**✅ 올바른 예시**
```yaml
# int()로 감싸서 모든 요소를 int 타입으로 통일
command_on:
  - action: send_packet
    data: "[0x02, 0x80, int(get_from_states('light_1', 'value'))]"
```

## 제한 사항 (Limitations)

CEL 도입으로 인해 기존 `!lambda`에서 가능했던 일부 기능이 더 이상 지원되지 않습니다. 이는 보안성과 안정성을 높이기 위한 의도적인 제약입니다.

1.  **반복문 사용 불가 (No Loops)**
    *   `for`, `while` 등의 반복문을 사용할 수 없습니다.
    *   따라서 가변 길이의 데이터를 순회하며 체크섬을 계산하거나 복잡한 알고리즘을 수행하는 로직은 단일 표현식으로 구현하기 어렵습니다.

2.  **부작용 없음 (No Side Effects)**
    *   CEL 표현식은 순수(Pure)해야 합니다.
    *   로그 출력, 외부 명령 실행 등의 부작용이 있는 함수는 지원되지 않습니다.
    *   명령 실행이 필요한 경우, 자동화(Automation)의 `then:` 블록에서 `action: command`를 사용하세요.

3.  **제한된 표준 라이브러리**
    *   JavaScript의 모든 표준 객체(`Math`, `Date` 등)를 사용할 수 없으며, 제공된 연산자와 헬퍼 함수만 사용 가능합니다.
