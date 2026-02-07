# 스니펫 갤러리 가이드

스니펫 갤러리는 커뮤니티에서 공유한 설정을 웹 UI에서 확인하고 적용할 수 있는 기능입니다. 각 스니펫은 YAML 형식으로 제공되며 아래 항목을 포함할 수 있습니다.

## 갤러리 데이터 제공 경로

- 갤러리 목록: `/api/gallery/list`
- 스니펫 파일: `/api/gallery/file?path=<vendor/file.yaml>`
- ⚠️ 위 파일들은 갤러리 업데이트 후 저장소에 push될 때 github actions로 자동으로 업데이트 되므로 수동으로 업데이트할 필요 없음.

서비스는 GitHub 저장소(`https://raw.githubusercontent.com/wooooooooooook/homenet2mqtt/main/gallery/`)에서 파일을 가져와 위 API로 프록시합니다. 이를 통해 갤러리 업데이트가 GitHub에 push되면 자동으로 반영됩니다.

## 스니펫 구성

- `entities`: 엔티티 설정 모음 (`light`, `sensor` 등 엔티티 타입별 배열)
- `automation`: 자동화 규칙 배열
- `scripts`: 스크립트 정의 배열

`scripts` 항목은 자동화 액션에서 재사용할 수 있는 스크립트 정의를 담습니다. 갤러리에서 스니펫을 적용하면 `scripts` 항목도 함께 구성 파일에 병합됩니다.

## 기존 엔티티 매칭

스니펫을 적용할 때, **엔티티 ID가 다르더라도 패킷 패턴(예: `state.data`, `state.mask`, `state.offset`, `command_*` 설정)이 동일하면 기존 엔티티와 매칭**됩니다. 이 경우 UI에서 다음 중 하나를 선택해 적용할 수 있습니다.

- **기존 항목 덮어쓰기**: 매칭된 기존 엔티티를 스니펫 내용으로 교체합니다.
- **새 항목으로 추가**: 스니펫 ID 그대로 새 엔티티를 추가합니다.
- **건너뛰기**: 해당 스니펫 엔티티를 적용하지 않습니다.

> 매칭은 패킷 스키마를 기준으로 하며, 이름/ID는 비교 대상이 아닙니다. 동일 패턴이지만 실제 장치가 다를 가능성이 있는 경우 “새 항목으로 추가”를 선택하세요.

## 템플릿 기반 스니펫 스키마

### 목표

- **파라미터 기반 템플릿**: 사용자 입력에 따라 동적으로 엔티티 생성
- **중첩 반복 지원**: 방 개수 × 조명 개수처럼 2단계 반복 처리
- **하위 호환성 유지**: 기존 정적 YAML 스니펫은 그대로 적용
- **안전한 표현식 평가**: Common Expression Language (CEL) 기반의 안전한 샌드박스 실행

### 메타데이터 (`meta`)

스니펫의 기본 정보를 정의합니다.

```yaml
meta:
  name: "My Template"
  author: "User"
  version: "1.0.0"
  min_version: "1.15.0"  # 최소 요구 애드온 버전
  tags: ["light", "kocom"]
```

`min_version`을 명시하면 해당 버전보다 낮은 애드온에서는 스니펫 적용이 차단되고 업데이트 안내 메시지가 표시됩니다.

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

#### 파라미터 고급 설정

| 속성 | 설명 | 예시 |
| --- | --- | --- |
| `hidden` | UI에 표시되지 않는 숨겨진 파라미터입니다. | `hidden: true` |
| `computed` | 계산된 파라미터입니다 (보통 `hidden`과 함께 사용). | `computed: true` |

> **Tip:** `object[]` 타입의 경우, 배열 아이템에 일부 속성이 누락되어 있으면 `schema.properties`에 정의된 `default` 값이 자동으로 병합됩니다. 예를 들어 Discovery 결과에 `light_count`가 없더라도 스키마에 `default: 2`가 있다면 자동으로 채워집니다.

### 조건부 포함 (`$if`)

특정 조건에 따라 엔티티나 노드를 포함하거나 제외할 수 있습니다.

```yaml
entities:
  light:
    - $if: '{{light_count >= 2}}'
      id: 'light_2'
      name: 'Light 2'
```

조건식(CEL)이 `true`로 평가되면 해당 노드가 포함되고, `false`이면 결과에서 완전히 제거됩니다. `$repeat` 블록 내부나 `nested` 구조에서도 사용할 수 있습니다.



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

### 템플릿 표현식 (Common Expression Language)

표현식 문법: `{{expression}}`

템플릿 표현식은 **[Common Expression Language (CEL)](https://github.com/google/cel-spec)**을 사용합니다.
- JavaScript 문법과 유사하지만 더 엄격하며 안전합니다.
- `process`, `window`, `require` 등 글로벌 객체에 접근할 수 없습니다.
- `Math` 함수는 지원되지 않으므로 기본 사칙연산과 제공된 헬퍼 함수만 사용해야 합니다.

지원 표현식 예시:

| 표현식 | 설명 | 예시 |
| --- | --- | --- |
| `{{i}}` | 변수 직접 참조 | `1`, `2`, ... |
| `{{i + 1}}` | 산술 연산 | `2`, `3`, ... |
| `{{i * 2}}` | 곱셈 | `2`, `4`, ... |
| `{{room.name}}` | 객체 속성 접근 | `"거실"` |
| `{{hex(i)}}` | 헬퍼 함수: 16진수 변환 | `"0x01"` |
| `{{pad(i, 2)}}` | 헬퍼 함수: 자릿수 패딩 | `"01"` |
| `{{bcd_to_int(i)}}` | BCD → 정수 변환 | `0x12` → `12` |
| `{{int_to_bcd(i)}}` | 정수 → BCD 변환 | `12` → `0x12` |
| `{{bitAnd(i, 0x0F)}}` | 비트 AND | `0x1F` → `0x0F` |
| `{{bitOr(i, 0x80)}}` | 비트 OR | `0x01` → `0x81` |
| `{{bitXor(i, 0xFF)}}` | 비트 XOR | `0x00` → `0xFF` |
| `{{bitNot(i)}}` | 비트 NOT | `0` → `-1` |
| `{{bitShiftLeft(i, 4)}}` | 비트 Left Shift | `0x01` → `0x10` |
| `{{bitShiftRight(i, 4)}}` | 비트 Right Shift | `0x10` → `0x01` |

**주의사항:**
- 변수는 `parameters`나 `$repeat`에서 정의된 것만 사용할 수 있습니다.
- 정의되지 않은 변수를 사용하면 에러가 발생합니다.

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
```

### match (패킷 매칭)

패킷딕셔너리에서 분석할 패킷을 필터링합니다.

#### 기본 매칭
| 속성 | 필수 | 설명 | 예시 |
| --- | --- | --- | --- |
| `data` | ✓ | 매칭할 바이트 패턴 | `[0xB0]`, `[0x0E, 0x00, 0x81]` |
| `mask` |  | 비교 시 적용할 마스크 | `[0xF0]` (상위 4비트만 비교) |
| `offset` |  | 패킷 내 비교 시작 위치 (기본: 0) | `0` |

#### 고급 매칭 (Regex, Condition, AnyOf)

복잡한 매칭이 필요한 경우 다음 옵션을 사용할 수 있습니다.

**1. Regex 매칭 (`regex`)**
패킷의 Hex 문자열 표현에 대해 정규표현식으로 매칭합니다.
```yaml
match:
  regex: "B0 41 .. 02"  # 3번째 바이트는 와일드카드
```

**2. 조건부 매칭 (`condition`)**
CEL 표현식을 사용해 값을 비교합니다.
- **Context**: `data` (패킷 바이트 배열), `len` (패킷 길이)
```yaml
match:
  condition: "data[2] > 0x10 && data[5] == 0x02"
```

**3. 다중 조건 (`any_of`)**
여러 조건 중 하나라도 만족하면 매칭 (OR 로직).
```yaml
match:
  any_of:
    - data: [0xB0]
    - regex: "A0 .. 01"
```

### dimensions (디바이스 차원)

하나 이상의 파라미터를 패킷 데이터에서 추출합니다.

| 속성 | 필수 | 설명 |
| --- | --- | --- |
| `parameter` | ✓ | 연결할 파라미터 이름 |
| `offset` | ✓ | 값을 추출할 바이트 오프셋 |
| `mask` |  | 추출 시 적용할 비트 마스크 |
| `transform` |  | CEL 표현식으로 값 변환 (Context: `x`) |

#### 예시: CEL Transform 사용
특정 비트를 추출하거나 값을 변환할 때 사용합니다.
```yaml
dimensions:
  - parameter: "room_id"
    offset: 1
    transform: "bitShiftRight(x, 4)" # 상위 4비트 추출
```

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

#### 예시: 다차원 추론 (`unique_tuples`)
방 번호(`room_idx`)와 조명 개수(`count`)를 조합하여 객체 배열을 생성하는 예시입니다.

```yaml
inference:
  strategy: "unique_tuples"
  output: "rooms"  # parameters에 있는 'rooms' (object[]) 변수에 결과 저장
```

이 전략은 발견된 각 파라미터 조합을 유일한 튜플로 만들어 배열로 반환합니다. 결과는 다음과 같은 형태가 됩니다:
`[{room_idx: 1, count: 2}, {room_idx: 2, count: 1}]`
```
