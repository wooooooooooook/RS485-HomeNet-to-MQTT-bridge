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
