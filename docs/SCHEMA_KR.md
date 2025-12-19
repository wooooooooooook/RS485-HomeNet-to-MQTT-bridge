# Protocol Schema Documentation

이 문서는 프로토콜 정의 및 상태 추출 스키마(`StateSchema`, `StateNumSchema`)에 대해 설명합니다.

## StateSchema

`StateSchema`는 패킷에서 상태를 추출하거나 매칭하는 데 사용되는 기본 스키마입니다.

| 속성       | 타입                   | 설명                                                                                                                        |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `offset`   | `number`               | 패킷 내 데이터 시작 오프셋 (헤더 포함 여부는 컨텍스트에 따름)                                                               |
| `data`     | `number[]`             | 패킷 매칭을 위한 예상 데이터 패턴. 설정된 경우, 해당 위치의 데이터가 이 패턴과 일치해야만 값이 추출됩니다.                  |
| `mask`     | `number` \| `number[]` | 데이터 매칭 및 값 추출 시 적용할 비트 마스크. `data`와 비교할 때, 그리고 값을 추출할 때 `(value & mask)` 연산이 수행됩니다. |
| `inverted` | `boolean`              | `true`인 경우, 값을 추출하기 전에 비트 반전(`~value`)을 수행합니다. (마스크 적용 전)                                        |

## StateNumSchema

`StateNumSchema`는 `StateSchema`를 확장하여 숫자 또는 변환된 값을 추출하기 위한 추가적인 속성을 제공합니다.

| 속성        | 타입                  | 기본값   | 설명                                                                                         |
| ----------- | --------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `length`    | `number`              | 1        | 추출할 데이터의 바이트 길이                                                                  |
| `endian`    | `'big'` \| `'little'` | `'big'`  | 바이트 순서 (Big Endian 또는 Little Endian)                                                  |
| `signed`    | `boolean`             | `false`  | 부호 있는 정수 여부 (2의 보수법 적용)                                                        |
| `precision` | `number`              | 0        | 소수점 자리수. 예: 값이 123이고 precision이 2이면 1.23이 됩니다.                             |
| `decode`    | `DecodeEncodeType`    | `'none'` | 디코딩 방식 (`bcd`, `ascii`, `signed_byte_half_degree` 등)                                   |
| `mapping`   | `Object`              | -        | 값 매핑 테이블. 추출된 숫자를 특정 문자열이나 값으로 변환합니다. 예: `{ 1: 'ON', 0: 'OFF' }` |

### Decode Types

- `bcd`: Binary Coded Decimal 디코딩
- `ascii`: ASCII 문자열로 디코딩
- `signed_byte_half_degree`: 0.5도 단위의 부호 있는 바이트 디코딩 (특정 프로토콜용)
- `none`: 기본 정수 디코딩

## 예제

### 단순 값 추출

```yaml
# 3번째 바이트 추출
state:
  offset: 3
  length: 1
```

### 비트 마스크 및 매핑

```yaml
# 4번째 바이트의 하위 4비트 추출 후 매핑
state:
  offset: 4
  mask: 0x0F
  mapping:
    0: 'OFF'
    1: 'LOW'
    2: 'HIGH'
```

### 멀티 바이트, 리틀 엔디안, 정밀도

```yaml
# 5~6번째 바이트(2바이트)를 리틀 엔디안으로 읽고, 10으로 나눔 (소수점 1자리)
state:
  offset: 5
  length: 2
  endian: 'little'
  precision: 1
```

## CommandSchema

`CommandSchema`는 장치로 전송할 명령 패킷을 정의하는 스키마입니다.

| 속성              | 타입                   | 기본값   | 설명                                                                       |
| ----------------- | ---------------------- | -------- | -------------------------------------------------------------------------- |
| `data`            | `number[]`             | -        | 전송할 기본 패킷 데이터 (16진수 배열).                                     |
| `value_offset`    | `number`               | -        | `data` 배열 내에서 입력값(value)이 삽입될 시작 인덱스.                     |
| `length`          | `number`               | 1        | 입력값이 차지할 바이트 수.                                                 |
| `endian`          | `'big'` \| `'little'`  | `'big'`  | 값의 바이트 순서.                                                          |
| `value_encode`    | `DecodeEncodeType`     | `'none'` | 값 인코딩 방식 (`bcd`, `ascii`, `multiply` 등).                            |
| `multiply_factor` | `number`               | -        | `value_encode: multiply` 사용 시 곱할 계수.                                |
| `low_priority`    | `boolean`              | `false`  | `true`인 경우, 해당 명령을 낮은 우선순위 큐로 전송합니다. 자동화 액션에서 오버라이드 가능합니다. |

## Automation Action

자동화(`automation`)에서 명령(`command`) 액션을 사용할 때 다음 옵션을 사용할 수 있습니다.

### action: command

| 속성           | 타입      | 설명                                                                                                                                              |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`       | `string`  | 대상 엔티티와 명령 (`id(entity).command_on()`).                                                                                                   |
| `input`        | `any`     | 명령에 전달할 값.                                                                                                                                 |
| `low_priority` | `boolean` | `true`로 설정 시 일반(높은 우선순위) 명령 큐가 비어있을 때만 실행됩니다. `schedule` 트리거에 의한 명령은 기본값이 `true`로 자동 설정됩니다. |
