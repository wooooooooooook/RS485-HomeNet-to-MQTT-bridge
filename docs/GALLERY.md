# 스니펫 갤러리 가이드

스니펫 갤러리는 커뮤니티에서 공유한 설정을 웹 UI에서 확인하고 적용할 수 있는 기능입니다. 각 스니펫은 YAML 형식으로 제공되며 아래 항목을 포함할 수 있습니다.

## 갤러리 데이터 제공 경로

- 갤러리 목록: `/api/gallery/list`
- 스니펫 파일: `/api/gallery/file?path=<vendor/file.yaml>`

서비스는 GitHub 저장소(`https://raw.githubusercontent.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/main/gallery/`)에서 파일을 가져와 위 API로 프록시합니다. 이를 통해 갤러리 업데이트가 GitHub에 push되면 자동으로 반영됩니다.

## 스니펫 구성

- `entities`: 엔티티 설정 모음 (`light`, `sensor` 등 엔티티 타입별 배열)
- `automation`: 자동화 규칙 배열
- `scripts`: 스크립트 정의 배열

`scripts` 항목은 자동화 액션에서 재사용할 수 있는 스크립트 정의를 담습니다. 갤러리에서 스니펫을 적용하면 `scripts` 항목도 함께 구성 파일에 병합됩니다.

## 템플릿 기반 스니펫 스키마

### 목표

- **파라미터 기반 템플릿**: 사용자 입력에 따라 동적으로 엔티티 생성
- **중첩 반복 지원**: 방 개수 × 조명 개수처럼 2단계 반복 처리
- **하위 호환성 유지**: 기존 정적 YAML 스니펫은 그대로 적용

### 파라미터 정의 (`parameters`)

```yaml
parameters:
  - name: light_count
    type: integer
    default: 4
    min: 1
    max: 8
    label: "조명 개수"
    label_en: "Light Count"
    description: "생성할 조명 개수를 입력하세요"
```

지원 타입:

| 타입 | 설명 | 예시 |
| --- | --- | --- |
| `integer` | 단일 정수 | `4` |
| `string` | 단일 문자열 | `"거실"` |
| `integer[]` | 정수 배열 | `[4, 3, 2]` |
| `object[]` | 객체 배열 | `[{name: "거실", count: 4}]` |

### 반복 블록 (`$repeat`)

단일 레벨 반복:

```yaml
entities:
  light:
    - $repeat:
        count: '{{light_count}}'
        as: i
        start: 1

      id: 'light_{{i}}'
      name: 'Light {{i}}'
      state:
        data: [0xB0, 0x00, '{{i}}']
        mask: [0xF0, 0x00, 0xFF]
      command_on:
        data: [0x31, '{{i}}', 0x01, 0x00, 0x00, 0x00, 0x00]
```

`$repeat` 속성:

| 속성 | 필수 | 설명 |
| --- | --- | --- |
| `count` | ✓ | 반복 횟수 (`숫자` 또는 `{{변수}}`) |
| `as` | ✓ | 현재 인덱스 변수명 |
| `start` |  | 시작 인덱스 (기본값: 1) |
| `over` |  | 배열 반복 시 배열 변수명 (count 대신 사용) |
| `index` |  | 0-based 인덱스 변수명 (선택) |

### 중첩 반복 (`$nested`)

방 × 조명처럼 2단계 반복:

```yaml
parameters:
  - name: rooms
    type: object[]
    default:
      - name: "거실"
        light_count: 4
      - name: "안방"
        light_count: 3
    schema:
      name: { type: string, label: "방 이름" }
      light_count: { type: integer, min: 1, max: 8, label: "조명 개수" }
entities:
  light:
    - $repeat:
        over: rooms
        as: room
        index: room_idx
      $nested:
        $repeat:
          count: '{{room.light_count}}'
          as: light_num

        id: 'light_{{room_idx + 1}}_{{light_num}}'
        name: '{{room.name}} 조명 {{light_num}}'
        state:
          data: [0xB0, '{{room_idx + 1}}', '{{light_num}}']
          mask: [0xF0, 0xFF, 0xFF]
        command_on:
          data: [0x31, '{{room_idx + 1}}', '{{light_num}}', 0x01, 0x00, 0x00, 0x00]
```

### 템플릿 표현식

문법: `{{expression}}`

지원 표현식:

| 표현식 | 설명 | 예시 |
| --- | --- | --- |
| `{{i}}` | 변수 직접 참조 | `1`, `2`, ... |
| `{{i + 1}}` | 산술 연산 | `2`, `3`, ... |
| `{{room.name}}` | 객체 속성 접근 | `"거실"` |
| `{{i | hex}}` | 필터: 16진수 변환 | `0x01` |
| `{{i | pad:2}}` | 필터: 자릿수 패딩 | `"01"` |

### 전체 예시

```yaml
meta:
  name: "☑️조명 설정"
  name_en: "☑️Lights"
  description: "코맥스 조명 설정입니다. 개수를 지정할 수 있습니다."
  version: "2.0.0"
  author: "wooooooooooook"
  tags: ["light", "commax"]
parameters:
  - name: light_count
    type: integer
    default: 4
    min: 1
    max: 8
    label: "조명 개수"
    label_en: "Number of Lights"
entities:
  light:
    - $repeat:
        count: '{{light_count}}'
        as: i
        start: 1

      id: 'light_{{i}}'
      name: 'Light {{i}}'
      state:
        data: [0xB0, 0x00, '{{i}}']
        mask: [0xF0, 0x00, 0xFF]
      state_on:
        offset: 1
        data: [0x01]
      state_off:
        offset: 1
        data: [0x00]
      command_on:
        data: [0x31, '{{i}}', 0x01, 0x00, 0x00, 0x00, 0x00]
        ack: [0xB1, 0x01, '{{i}}']
      command_off:
        data: [0x31, '{{i}}', 0x00, 0x00, 0x00, 0x00, 0x00]
        ack: [0xB1, 0x00, '{{i}}']
```

생성 결과 (light_count = 3):

```yaml
entities:
  light:
    - id: 'light_1'
      name: 'Light 1'
      state:
        data: [0xB0, 0x00, 0x01]
        mask: [0xF0, 0x00, 0xFF]
    - id: 'light_2'
      name: 'Light 2'
    - id: 'light_3'
      name: 'Light 3'
```

## Discovery 스키마

### 개요

Discovery 기능은 브릿지에서 수집된 패킷딕셔너리를 분석하여:
1. **갤러리 목록**: 매칭되는 패킷이 있으면 "🔍 발견됨" 뱃지 표시
2. **스니펫 모달**: 발견된 디바이스 개수를 파라미터 기본값으로 자동 입력

### 기본 구조

```yaml
discovery:
  # 패킷 매칭 규칙
  match:
    data: [0xB0]              # 매칭할 바이트 패턴
    mask: [0xF0]              # 비교 마스크 (선택)
    offset: 0                 # 시작 오프셋 (기본값: 0)

  # 디바이스 식별 차원 정의
  dimensions:
    - parameter: "light_count"
      offset: 2               # data[2]에서 디바이스 ID 추출

  # 추론 전략
  inference:
    strategy: "count"         # 고유값 개수 세기

  # UI 표시
  ui:
    label: "조명"
    label_en: "Light"
    summary: "{light_count}개 조명 발견됨"
    summary_en: "{light_count} lights discovered"
```

### match (패킷 매칭)

패킷딕셔너리에서 분석할 패킷을 필터링합니다.

| 속성 | 필수 | 설명 | 예시 |
| --- | --- | --- | --- |
| `data` | ✓ | 매칭할 바이트 패턴 | `[0xB0]`, `[0x0E, 0x00, 0x81]` |
| `mask` |  | 비교 시 적용할 마스크 | `[0xF0]` (상위 4비트만 비교) |
| `offset` |  | 패킷 내 비교 시작 위치 (기본: 0) | `0` |

매칭 로직:
```
(packet[offset + i] & mask[i]) == (data[i] & mask[i])
```

예시:
```yaml
# 0xB0~0xBF로 시작하는 패킷 매칭
match:
  data: [0xB0]
  mask: [0xF0]

# data[0]=0x0E, data[2]의 상위 2비트=10인 패킷
match:
  data: [0x0E, 0x00, 0x80]
  mask: [0xFF, 0x00, 0xC0]
```

### dimensions (디바이스 차원)

하나 이상의 파라미터를 패킷 데이터에서 추출합니다.

| 속성 | 필수 | 설명 |
| --- | --- | --- |
| `parameter` | ✓ | 연결할 파라미터 이름 |
| `offset` | ✓ | 값을 추출할 바이트 오프셋 |
| `mask` |  | 추출 시 적용할 비트 마스크 |
| `transform` |  | CEL 표현식으로 값 변환 |

#### 단일 차원 (조명 N개)

```yaml
dimensions:
  - parameter: "light_count"
    offset: 2                 # data[2]에서 조명 ID 추출
```

패킷 예시: `B0 01 01`, `B0 00 02`, `B0 00 03` → `light_count = 3`

#### 다중 차원 (방 N개 × 조명 M개)

```yaml
dimensions:
  # 첫 번째 차원: 방 번호
  - parameter: "room_count"
    offset: 1
    transform: "bitAnd(x, 0x0F)"  # 0x11 → 1, 0x12 → 2

  # 두 번째 차원: 조명 번호
  - parameter: "light_count"
    offset: 4
```

패킷 예시:
- `0E 11 81 03 01 01 00` → 방1, 조명1
- `0E 11 81 03 02 01 00` → 방1, 조명2
- `0E 12 81 03 01 01 00` → 방2, 조명1

결과: `room_count = 2`, `light_count = 2` (방당 최대값)

#### 비트 기반 디바이스 검출

조명 상태가 비트맵으로 표현되는 경우:

```yaml
dimensions:
  - parameter: "light_count"
    offset: 5
    detect: "active_bits"     # 활성 비트 수 = 조명 개수
```

패킷 예시: `... 05 07 00 00` (data[5]=0x07=0b111) → `light_count = 3`

### inference (추론 전략)

| 전략 | 설명 | 결과 예시 |
| --- | --- | --- |
| `max` | 최대값 (기본값) | `{ light_count: 5 }` |
| `count` | 고유값 개수 | `{ light_count: 4 }` |
| `unique_tuples` | 다차원 고유 조합 | `{ rooms: [{id:1, lights:3}, {id:2, lights:2}] }` |
| `grouped` | 그룹별 개수 | `{ room_lights: {1: 3, 2: 2} }` |

```yaml
inference:
  strategy: "max"  # 기본값, 생략 가능
  # 또는 다차원용
  strategy: "unique_tuples"
  output: "room_lights"       # object[] 파라미터로 출력
```

### 엣지 케이스 처리

#### 중간 ID가 누락된 경우

패킷: `B0 01 01`, `B0 00 03` (ID 2가 없음)

| 전략 | 결과 | 설명 |
| --- | --- | --- |
| `max` (기본) | 3 | 최대 ID 값 → 누락 없음 |
| `count` | 2 | 실제 발견된 고유 ID 개수 |

```yaml
# 실제 발견된 디바이스만 설정하려면
inference:
  strategy: "count"
```

> 💡 **기본값이 `max`인 이유**: `count`를 사용하면 ID 1, 3만 발견 시 엔티티 1, 2가 생성되어 ID 3이 누락됩니다. `max`를 사용하면 1, 2, 3 모두 생성되어 ID 2는 비활성화 엔티티가 되지만 누락은 발생하지 않습니다.

#### 동일 기기의 여러 패킷 타입

패킷: `B0 01 01` (상태), `B0 00 01` (상태 OFF), `B1 00 01` (ACK)

세 패킷 모두 `data[2] = 0x01`이지만, ACK 패킷(`B1`)은 제외해야 합니다.

**해결**: `match.mask`로 정확한 헤더만 필터링

```yaml
# 0xB0만 매칭 (0xB1 제외)
match:
  data: [0xB0]
  mask: [0xFF]

# 결과: B0 01 01, B0 00 01만 매칭 → light_count = 1
```

**여러 헤더를 포함해야 하는 경우**: `any_of` 사용

```yaml
match:
  any_of:
    - data: [0xB0]
      mask: [0xFF]
    - data: [0x82]  # 추가로 0x82도 매칭
      mask: [0xFF]
```

### ui (사용자 표시)

```yaml
ui:
  label: "난방기"
  label_en: "Heater"
  badge: "🔥"                 # 갤러리 카드 뱃지 아이콘
  summary: "{heater_count}개 난방기 발견됨"
  summary_en: "{heater_count} heaters discovered"
```

### 전체 예시

#### 예시 1: 단일 파라미터 (조명 개수)

```yaml
meta:
  name: "☑️조명 설정"
  version: "2.0.0"
  tags: ["light", "commax"]

discovery:
  match:
    data: [0xB0]
    mask: [0xF0]
  dimensions:
    - parameter: "light_count"
      offset: 2
  ui:
    label: "조명"
    summary: "{light_count}개 조명 발견됨"

parameters:
  - name: light_count
    type: integer
    default: 4
    min: 1
    max: 9
    label: "조명 개수"

entities:
  light:
    - $repeat:
        count: '{{light_count}}'
        as: i
        start: 1
      id: 'light_{{i}}'
      # ...
```

#### 예시 2: 다중 파라미터 (방별 조명)

```yaml
meta:
  name: "☑️조명 설정 (방별)"
  version: "2.0.0"
  tags: ["light", "ezville"]

discovery:
  match:
    data: [0x0E, 0x00, 0x81]
    mask: [0xFF, 0xF0, 0xFF]
  dimensions:
    - parameter: "room_count"
      offset: 1
      transform: "x & 0x0F"
    - parameter: "lights_per_room"
      offset: 4
  inference:
    strategy: "grouped"
  ui:
    label: "조명"
    summary: "{room_count}개 방, 총 {total}개 조명"

parameters:
  - name: room_count
    type: integer
    default: 3
    label: "방 개수"
  - name: lights_per_room
    type: integer
    default: 4
    label: "방당 조명 개수"

entities:
  light:
    - $repeat:
        count: '{{room_count}}'
        as: room
        start: 1
      $nested:
        $repeat:
          count: '{{lights_per_room}}'
          as: light
          start: 1
        id: 'light_{{room}}_{{light}}'
        # ...
```

#### 예시 3: 객체 배열 파라미터 (방별 다른 조명 개수)

```yaml
discovery:
  match:
    data: [0x0E]
  dimensions:
    - parameter: "room_id"
      offset: 1
      transform: "x & 0x0F"
    - parameter: "light_id"
      offset: 4
  inference:
    strategy: "unique_tuples"
    output: "rooms"
  ui:
    summary: "{room_count}개 방 발견됨"

parameters:
  - name: rooms
    type: object[]
    label: "방별 조명 설정"
    schema:
      room_id: { type: integer, label: "방 번호" }
      light_count: { type: integer, label: "조명 개수" }
    # Discovery 결과로 자동 채워짐:
    # [{ room_id: 1, light_count: 5 }, { room_id: 2, light_count: 2 }]
```

