# Text 스키마 작성법

문자열을 송수신하는 장치는 `text` 엔티티를 사용합니다. `type`은 `text`이며 공통 필드(`id`, `name`, `packet_parameters`, `device_class`, `icon`)를 함께 지정할 수 있습니다.

## 필수 필드
- `command_text`: 입력된 문자열을 패킷으로 변환하여 장치로 전송하는 방법 (CEL 표현식 또는 스키마).

## 옵션 필드
- `state`: 이 텍스트 상태가 포함된 패킷을 식별하는 서명.
- `state_text`: 문자열 상태를 추출하는 방법 (CEL 표현식 또는 스키마).
- `min_length`, `max_length`: 사용자 입력값의 최소/최대 길이 (UI에서 검증).
- `pattern`: 입력값 검증을 위한 정규식 문자열.
- `mode`: 입력 UI 모드 (`text` 또는 `password`).

## 예제 1: 스키마 기반 (ASCII 전송)
입력받은 문자열을 ASCII로 인코딩하여 패킷의 특정 위치에 삽입합니다.
```yaml
text:
  - id: elevator_notice
    name: "엘리베이터 안내"
    mode: text
    min_length: 0
    max_length: 16
    command_text:
      data: [0x30, 0xd0, 0x00, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
      value_offset: 4
      length: 6
      value_encode: ascii
```

## 예제 2: CEL 표현식
복잡한 로직이 필요하거나 문자열을 가공하여 전송해야 할 때 사용합니다. 문자열 입력값은 `xstr` 변수를 통해 접근합니다.
```yaml
text:
  - id: custom_message
    name: "사용자 메시지"
    command_text: >-
      [0x01, 0x02] + bytes(xstr) + [0x03]
```

## 작성 체크리스트
1. 입력 길이를 장치 버퍼 크기보다 짧게 설정해 오버플로를 방지합니다.
2. `command_text`에서 `value_encode: ascii`를 사용할 경우 `length`를 충분히 지정했는지 확인하세요.
3. 비밀번호 입력은 `mode: password`로 표시만 가리고, 전송 데이터는 평문/암호화 여부를 장치 사양에 맞춰 설정합니다.
4. 텍스트 인코딩이 특수하면 CEL 표현식에서 직접 바이트 배열을 생성해 반환합니다.
