# Select 스키마 작성법

여러 옵션 중 하나를 선택하는 장치는 `select` 엔티티를 사용합니다. `type`은 `select`이며 공통 필드(`id`, `name`, `packet_parameters`, `icon`)를 함께 지정합니다.

## 필수 필드
- `options`: 사용자가 고를 수 있는 문자열 배열.

## 옵션 필드 (상태)
- `state`: 상태 패킷 서명.
- `state_select`: 패킷 바이트를 옵션 문자열로 변환. 다음 방식 중 선택:
  - **스키마 기반**: `offset`, `length`, `map` 속성으로 숫자→문자열 매핑 ([`StateNumSchema`](./schemas.md#statenumschema) 참고)
  - **CEL 표현식**: 문자열을 반환하는 CEL 표현식
- `initial_option`: 장치 초기화 시 기본 선택값.
- `restore_value`: 재시작 시 마지막 값을 복원할지 여부(Boolean).

## 옵션 필드 (명령)
- `command_select`: 선택된 옵션을 장치에 반영하는 명령. 다음 방식 중 선택:
  - **스키마 기반**: `data`, `value_offset`, `map` 으로 문자열→숫자 매핑
  - **CEL 표현식**: `xstr` 변수로 선택된 옵션을 받아 바이트 배열 반환

## 예제 1: 스키마 기반 (map 사용)
```yaml
select:
  - id: air_mode
    name: "환기 모드"
    options: ["auto", "sleep", "turbo"]
    state:
      data: [0x20, 0x01, 0x71]
    state_select:
      offset: 8
      length: 1
      map:
        0: "auto"
        1: "sleep"
        2: "turbo"
    command_select:
      data: [0x20, 0x71, 0x01, 0x11, 0x00]
      value_offset: 4
      map:
        "auto": 0
        "sleep": 1
        "turbo": 2
```

## 예제 2: CEL 표현식
```yaml
select:
  - id: air_mode
    name: "환기 모드"
    options: ["auto", "sleep", "turbo"]
    state:
      data: [0x20, 0x01, 0x71]
    state_select: >-
      data[8] == 0x01 ? "sleep" :
      (data[8] == 0x02 ? "turbo" : "auto")
    command_select: >-
      xstr == "sleep" ? [0x20, 0x71, 0x01, 0x11, 0x01] :
      (xstr == "turbo" ? [0x20, 0x71, 0x01, 0x11, 0x02] :
      [0x20, 0x71, 0x01, 0x11, 0x00])
```

## 작성 체크리스트
1. 옵션 문자열은 소문자/스네이크 케이스 등 일관된 형식을 유지해 자동화 스크립트와 충돌하지 않도록 합니다.
2. 장치가 부팅 시 특정 기본값을 요구하면 `initial_option`을 지정해 초기 패킷 전송 없이도 UI 상태를 맞춥니다.
3. 상태 해석이 복잡하면 임계값 매핑 또는 CEL 표현식을 활용해 가독성을 높입니다.
