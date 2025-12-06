# Select 스키마 작성법

여러 옵션 중 하나를 선택하는 장치는 `select` 엔티티를 사용합니다. `type`은 `select`이며 공통 필드(`id`, `name`, `packet_parameters`, `icon`)를 함께 지정합니다.

## 필수 필드
- `options`: 사용자가 고를 수 있는 문자열 배열.

## 옵션 필드 (상태)
- `state`: 상태 패킷 서명.
- `initial_option`: 장치 초기화 시 기본 선택값.
- `restore_value`: 재시작 시 마지막 값을 복원할지 여부(Boolean).
- `state_select`: 패킷을 옵션 문자열로 해석하는 [`CommandSchema`](./lambda.md#commandschema-필드) 또는 람다(문자열 반환).

## 옵션 필드 (명령)
- `command_select`: 선택된 옵션을 장치에 반영하는 명령. 입력 문자열을 바이트로 치환하려면 람다를 사용합니다.
- `command_update`: 상태 재요청.

## 예제: 환기 모드 선택 (예시)
```yaml
select:
  - id: air_mode
    name: "환기 모드"
    options: ["auto", "sleep", "turbo"]
    state:
      data: [0x20, 0x01, 0x71]
    state_select: !lambda |-
      if (data[8] === 0x00) return "auto";
      if (data[8] === 0x01) return "sleep";
      if (data[8] === 0x02) return "turbo";
      return "auto";
    command_select: !lambda |-
      const value = x === "sleep" ? 0x01 : x === "turbo" ? 0x02 : 0x00;
      return [0x20, 0x71, 0x01, 0x11, value];
```

## 작성 체크리스트
1. 옵션 문자열은 소문자/스네이크 케이스 등 일관된 형식을 유지해 자동화 스크립트와 충돌하지 않도록 합니다.
2. 장치가 부팅 시 특정 기본값을 요구하면 `initial_option`을 지정해 초기 패킷 전송 없이도 UI 상태를 맞춥니다.
3. 상태 해석이 복잡하면 [`StateLambdaConfig`](./lambda.md#statelambdaconfig)와 매핑 테이블을 활용해 가독성을 높입니다.
