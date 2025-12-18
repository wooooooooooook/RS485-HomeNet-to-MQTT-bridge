# Text 스키마 작성법

문자열을 송수신하는 장치는 `text` 엔티티를 사용합니다. `type`은 `text`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 지정합니다.

## 필수/옵션 필드 (상태)
- `state`: 이 텍스트 상태가 포함된 패킷 서명.
- `state_text`: 문자열 추출용 [`StateSchema`](./lambda.md#stateschema와-statenumschema-필드) 또는 CEL 표현식.
- 길이 제약: `min_length`, `max_length`.
- `pattern`: 입력 검증용 정규식 문자열.
- `mode`: `text`(일반) 또는 `password`(별표 처리).

## 옵션 필드 (명령)
- `command_text`: 입력 문자열을 장치로 전송하는 명령. `value_offset`과 `value_encode: ascii` 등을 조합하거나 람다 사용.
- `command_update`: 상태 재요청.

## 예제: 엘리베이터 안내문 전송 (예시)
```yaml
text:
  - id: elevator_notice
    name: "엘리베이터 안내"
    mode: text
    min_length: 0
    max_length: 16
    pattern: "^[A-Za-z0-9가-힣 ]+$"
    state:
      data: [0x30, 0xd0, 0x00, 0x44]
    state_text: !lambda |-
      return String.fromCharCode(...data.slice(8, 24)).trim();
    command_text:
      cmd: [0x30, 0xbc, 0x00, 0x44]
      value_offset: 8
      value_encode: ascii
      length: 16
```

## 작성 체크리스트
1. 입력 길이를 장치 버퍼 크기보다 짧게 설정해 오버플로를 방지합니다.
2. 비밀번호 입력은 `mode: password`로 표시만 가리고, 전송 데이터는 평문/암호화 여부를 장치 사양에 맞춰 설정합니다.
3. 텍스트 인코딩이 특수하면 람다에서 직접 바이트 배열을 생성해 반환합니다.
