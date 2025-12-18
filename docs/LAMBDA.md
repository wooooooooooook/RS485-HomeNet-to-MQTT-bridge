# ⚠️ Deprecation Warning

**이 문서는 더 이상 유효하지 않습니다.** `!lambda` 기능은 **CEL (Common Expression Language)**로 대체되었습니다.
최신 작성법은 **[CEL 가이드](CEL_GUIDE.md)**를 참고하세요.

---

# 홈넷 브리지 람다 기능 (Deprecated)

홈넷 브리지 시스템은 YAML 설정을 통해 장치 동작을 동적으로 정의할 수 있는 강력한 람다 기능을 제공했습니다. (현재는 CEL로 대체됨)

## `!lambda` 태그

YAML 설정 파일에서 `!lambda` 태그를 사용하여 JavaScript 코드를 직접 삽입할 수 있습니다. 이 코드는 시스템 내부의 안전한 샌드박스 환경에서 실행됩니다.

## 사용 목적

람다는 주로 두 가지 목적으로 사용됩니다.

1.  **상태 추출**: 장치로부터 받은 RS-485 데이터 패킷을 파싱하여 의미 있는 상태 값(예: 온도, 전등 상태)으로 변환합니다.
2.  **명령 생성**: MQTT 토픽으로 받은 명령을 실제 장치로 전송할 RS-485 데이터 패킷으로 변환합니다.

## 사용 예시

### 상태 추출 예시

다음은 조명 장치의 상태를 추출하는 람다 예시입니다. 패킷의 특정 바이트를 분석하여 조명의 `on`/`off` 상태를 반환합니다.

```yaml
light:
  - id: 1
    name: "거실 조명"
    state_power: !lambda |
      return data[4] === 0x01 ? 'ON' : 'OFF';
```

### Select 엔티티 상태 추출 예시

다음은 에어컨의 운전 모드를 추출하는 람다 예시입니다. 패킷의 값에 따라 미리 정의된 옵션 문자열을 반환해야 합니다.

```yaml
select:
  - id: ac_mode
    name: "에어컨 모드"
    options:
      - "냉방"
      - "난방"
      - "제습"
      - "송풍"
    state_select: !lambda |
      const mode = data[5];
      if (mode === 0x01) return '냉방';
      if (mode === 0x02) return '난방';
      if (mode === 0x03) return '제습';
      return '송풍';
```

### 명령 생성 예시

다음은 조명을 켜거나 끄는 명령 패킷을 생성하는 람다 예시입니다. 입력 값(`x`)에 따라 다른 데이터 배열을 반환합니다.

```yaml
light:
  - id: 1
    name: "거실 조명"
    command_power: !lambda |
      const header = [0x01, 0x02, 0x03, 0x04];
      const body = x === 'ON' ? [0x01] : [0x00];
      return header.concat(body);
```

## 실행 컨텍스트

람다 스크립트는 격리된 샌드박스 환경에서 실행되며, 미리 정의된 변수와 헬퍼 함수에만 접근할 수 있습니다.

### 사용 가능한 변수

#### 상태 추출 (`state_*`)

*   `data`: 장치로부터 수신된 원시 데이터 패킷 (숫자 배열).
*   `x`: 항상 `null` 입니다.

#### 명령 생성 (`command_*`)

*   `x`: 명령과 함께 전달된 값 (예: 'ON', 'OFF', 23.5).
*   `data`: 항상 빈 배열 `[]` 입니다.
*   `state`: 해당 장치의 현재 상태 값들을 담고 있는 객체.

### 사용 가능한 헬퍼 함수

*   `bcd_to_int(bcd)`: BCD(Binary-Coded Decimal) 값을 정수로 변환합니다.
*   `int_to_bcd(int)`: 정수를 BCD 값으로 변환합니다.
*   `log(...)`: 시스템 로그에 디버그 메시지를 출력합니다.

### 표준 객체

다음과 같은 표준 JavaScript 객체 및 함수를 사용할 수 있습니다.

*   `Math`
*   `Number`
*   `Boolean`
*   `String`
