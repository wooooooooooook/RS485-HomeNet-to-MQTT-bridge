# ⚠️ Deprecation Warning

**이 문서는 더 이상 유효하지 않습니다.** `!lambda` 기능은 **CEL (Common Expression Language)**로 대체되었습니다.
최신 작성법은 **[CEL 가이드](../CEL_GUIDE.md)**를 참고하세요.

---

# Lambda 작성법

`!lambda`를 사용하면 YAML에 직접 자바스크립트 코드를 적어 패킷 파싱·명령 생성·체크섬 계산을 동적으로 처리할 수 있습니다. 내부에서는 `vm` 샌드박스에서 실행되며, 타입 정의(`LambdaConfig`, `StateLambdaConfig`, `CommandLambdaConfig`)에 따라 전달되는 컨텍스트가 다릅니다.

## 공통 실행 환경
- 기본 유틸: `bcd_to_int`, `int_to_bcd`, `log`, 표준 `Math/Number/String/Boolean` 객체.
- 컨텍스트 데이터는 상황별로 병합됩니다.
  - **상태 람다**(`state_*: !lambda`): `{ data: <수신 패킷 바이트 배열>, x: null }`.
  - **명령 람다**(`command_*: !lambda`): `{ x: <입력값>, data: [], state: <해당 엔티티 현재 상태> }`.
  - **체크섬 람다**(`packet_defaults.rx_checksum`, `rx_checksum2`, `tx_checksum2`): `{ data: <헤더+데이터 바이트>, len: <데이터 길이> }`.
- 스크립트는 즉시 실행 함수로 감싸져 있어 `return [...]` 형태로 배열을 돌려주면 됩니다. 100ms 실행 제한이 있으므로 순수 계산에 집중하세요.

### YAML에서의 기초 형태
```yaml
command_on: !lambda |-
  // x: 서비스 호출 시 전달된 값
  const preset = x === 'sleep' ? 0x02 : 0x01;
  return [0x30, 0xbc, 0x00, 0x01, preset];
```

## StateSchema와 StateNumSchema 필드
모든 `state*` 필드는 `StateSchema` 또는 `StateNumSchema` 형태입니다.
- `data`: 매칭할 바이트 배열. 패킷이 이 배열과 일치해야 상태를 인정.
- `mask`: 단일 값 또는 배열. 특정 비트만 비교할 때 사용.
- `offset`: 패킷에서 비교/추출을 시작할 인덱스.
- `inverted`: `true`면 매칭 결과를 반전해 부정 조건을 표현.

`StateNumSchema`는 추가적으로 다음 필드를 가집니다.
- `length`: 읽을 바이트 길이(기본 1).
- `precision`: 소수점 자릿수. 예: `precision: 1`이면 123 → 12.3.
- `signed`: 부호 비트 해석 여부.
- `endian`: `big` 또는 `little`.
- `decode`: `none` | `bcd` | `ascii` | `signed_byte_half_degree` | `multiply` | `add_0x80`.
- `homenet_logic`: [`StateLambdaConfig`](#statelambdaconfig)를 이용한 추가 가공.
- `mapping`: `{ [byte값]: 문자열 | 숫자 }` 형태의 매핑 테이블.

## CommandSchema 필드
모든 `command*` 필드는 `CommandSchema`를 사용하거나 람다로 대체할 수 있습니다.
- `data`: 전송할 고정 바이트 배열.
- `cmd`: 별도 명령 바이트 배열(현재 구현에선 `data` 우선 사용).
- `value_offset`: 입력값을 삽입할 오프셋.
- `value_encode`: `DecodeEncodeType` 중 하나(`none/bcd/ascii/signed_byte_half_degree/multiply/add_0x80`).
- `length`: 값이 차지하는 바이트 수.
- `signed`: 부호 처리 여부.
- `endian`: `big` 또는 `little`.
- `multiply_factor`: `value_encode: multiply`일 때 곱할 값.
- `homenet_logic`: [`CommandLambdaConfig`](#commandlambdaconfig)으로 다중 패킷/조건 구성.

## StateLambdaConfig
`StateNumSchema.homenet_logic`에서 사용합니다.
- `conditions`: `extractor`로 특정 값이 일치할 때 `then` 값을 반환.
- `valueSource`: 입력값이 오는 위치(`packet` | `entity_state` | `input`). 오프셋·길이·디코딩 옵션을 함께 지정.
- `valueMappings`: `{ map: <비교값>, value: <치환값> }[]`로 특정 입력을 다른 값으로 변환.

### 예시: 바이트 값을 텍스트로 매핑
```yaml
state_temperature_current:
  offset: 10
  length: 1
  homenet_logic:
    valueSource:
      type: packet
      offset: 10
    valueMappings:
      - { map: 0xff, value: "sensor_error" }
```

## CommandLambdaConfig
`CommandSchema.homenet_logic`에서 사용하며, 다중 패킷 템플릿과 조건부 전송을 정의합니다.
- `conditions`: 엔티티 상태에 따라 다른 람다 블록을 선택할 수 있도록 체인 구성.
- `packetTemplates`: 전송할 패킷 템플릿 배열.
  - `data`: 기본 바이트 배열.
  - `conditions`: 다른 엔티티 상태(`entityId`, `property`)나 `extractor` 기준으로 템플릿 사용 여부를 결정.
  - `valueInsertions`: 오프셋별 값 삽입 규칙. `value` 또는 `valueSource`(`input`/`entity_state`)를 지정하고, `valueEncode`, `length`, `signed`, `endian`을 선택합니다.

### 예시: 두 채널을 한 번에 토글
```yaml
command_on:
  homenet_logic:
    packetTemplates:
      - data: [0x30, 0xbc, 0x00, 0x0e, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        valueInsertions:
          - valueOffset: 8
            valueSource: { type: entity_state, entityId: room_0_light_1, property: is_on }
            valueEncode: none
            length: 1
          - valueOffset: 9
            valueSource: { type: entity_state, entityId: room_0_light_2, property: is_on }
            valueEncode: none
            length: 1
```

## 체크섬 람다 예시
```yaml
packet_defaults:
  tx_header: [0x30, 0xbc]
  tx_checksum2: !lambda |-
    // data: 헤더와 명령 데이터가 합쳐진 배열
    let sum = 0;
    for (const b of data) sum = (sum + b) & 0xff;
    return [sum, (~sum) & 0xff];
```

## 디버깅 팁
- 샌드박스 안에서는 `console` 대신 `log(...)`를 호출해 값이 잘 들어오는지 확인합니다(로그는 기본 비활성화지만 예외 발생 여부 확인용으로 유용).
- 조건 분기나 매핑을 여러 단계로 쪼개 복잡도를 낮추면 100ms 제한을 안전하게 지킬 수 있습니다.
