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

## 템플릿 기반 스니펫 스키마 (설계)

> ⚠️ 이 섹션은 **설계 문서**이며, 실제 파서/백엔드/프론트엔드 구현 범위는 승인 후 결정합니다.
> 기존 스니펫을 변환하지 않으며, 기존 정적 YAML은 그대로 동작해야 합니다.

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

### 검증 계획

- 하위 호환성: 기존 정적 YAML 파일이 `parameters` 없이 정상 동작
- 단일 반복: `light_count = 4`로 조명 4개 생성 확인
- 중첩 반복: 방 2개 × 조명 `[4, 3]`개로 총 7개 엔티티 생성 확인
- 표현식 평가: `{{i}}`, `{{i + 1}}`, `{{room.name}}` 정상 치환

## 적용 시 동작

1. 기존 설정과 ID 충돌 여부를 확인합니다.
2. 충돌 항목은 덮어쓰기/건너뛰기/새 ID로 추가 중 하나를 선택할 수 있습니다.
3. 스니펫 적용 시 설정 파일이 백업됩니다.
