# 개선 제안: Gallery Schema (Parameters & Discovery)

## 1. Discovery 개선 제안

### 1-1. `match` 섹션의 유연성 부족
- **문제점**: 현재 `match`는 `data`, `mask`, `offset`을 사용한 단순 바이트 매칭만 지원합니다. 헤더가 가변적이거나 패턴이 복잡한 경우(예: 특정 비트가 가변적이나 특정 범위 내에 있어야 함) 매칭이 어렵습니다.
- **제안**:
  - **다중 매칭 조건 (`anyOf`)**: 여러 패턴 중 하나라도 일치하면 검색되도록 지원 필요. (예: 난방기 모델 A 또는 B 매칭)
  - **정규식 매칭 (Regex on Hex String)**: 헥사 문자열에 대한 정규식 지원 (예: `AA 55 .* 01 02`). 바이트 배열 매칭이 제한적인 경우 유용함.
  - **조건부 매칭 (Conditional Match)**: `data[2] == 0x30 && data[5] > 0x10`과 같이 CEL 표현식을 `match.condition`으로 지원하여 정밀한 패킷 필터링 가능.

### 1-2. `dimensions`의 `transform` 함수 제한
- **문제점**: 현재 `transform` 필드는 기본적인 비트 연산만 지원하거나 제한적입니다.
- **제안**:
  - `transform` 필드에서 CEL 표현식을 온전히 지원하여 복잡한 계산(예: `(x & 0xF0) >> 4`와 같은 복합 연산)을 한 줄로 처리할 수 있도록 개선.

### 1-3. `inference` 전략의 다양화
- **문제점**: `unique_tuples`나 `max` 외에, 패킷 내용을 기반으로 더 유연하게 파라미터를 추론하는 방법이 필요합니다.
- **제안**:
  - **Aggregation**: 수집된 여러 패킷을 집계하여(예: 1분간 수집된 패킷 중 등장한 모든 Room ID 리스트) 배열로 반환하는 기능.
  - **Map/Reduce**: 수집된 패킷들로부터 특정 구조(Map)를 생성하는 고급 추론.

## 2. Parameter 개선 제안

### 2-1. `object[]` 파라미터 내의 `hidden` 또는 `computed` 필드 부재
- **문제점**: `rooms` 파라미터 사용 시, 사용자가 입력할 필요는 없지만 템플릿 내부 계산을 위해 필요한 값(예: 내부적으로 계산된 Offset)을 저장할 공간이 부족합니다.
- **제안**:
  - 파라미터 스키마에 `hidden: true` 또는 `computed: true` 속성을 추가. UI에는 보이지 않지만, Discovery 과정에서 계산된 값이나 기본값이 저장되어 템플릿 생성 시 활용될 수 있어야 함.

### 2-2. 동적 기본값 (Dynamic Default Values)
- **문제점**: `default` 값이 정적입니다. Discovery 결과에 따라 기본값이 동적으로 바뀌어야 합니다.
- **제안**:
  - 파라미터의 `default` 필드에 CEL 표현식 사용 허용. (예: `default: discovery.results.max_count`)
  - 이를 통해 Discovery 된 데이터를 기반으로 사용자에게 더욱 지능적인 초기 설정값 제안 가능.

## 요약
가장 시급한 것은 **Discovery 매칭의 유연성 확보(Regex, CEL 조건절 등)**와 **Parameter 시스템의 표현력 강화(Hidden 필드, 동적 기본값)**입니다. 이를 통해 사용자 개입을 최소화하고 자동 설정을 고도화할 수 있습니다.
