# 스크립트(Script) 설정 가이드

`homenet_bridge` 설정에 `scripts` 블록을 추가하면 자동화 액션을 재사용 가능한 단위로 묶어둘 수 있습니다. 정의된 스크립트는
자동화(`automation`)의 액션으로 실행할 수 있고, 엔티티의 커맨드 스키마(`command_*`)에서도 참조하여 패킷 대신 액션 시퀀스를 수행할 수
있습니다.

## 기본 구조

```yaml
homenet_bridge:
  scripts:
    - id: warm_start
      description: 난방을 단계적으로 켜는 시퀀스
      actions:
        - action: command
          target: id(climate_livingroom).command_heat()
        - action: delay
          milliseconds: 30s
        - action: command
          target: id(climate_livingroom).command_temperature(23)
```

- `id` (필수): 스크립트 식별자입니다. 자동화 액션이나 커맨드 스키마에서 이 값을 참조합니다.
- `description` (선택): 스크립트 용도를 설명하는 메모입니다.
- `actions` (필수): 자동화 액션 배열입니다. `automation.then`/`automation.else`에서 사용하는 액션들과 동일한
  스키마(`command`, `delay`, `log`, `publish`, `send_packet` 등)를 그대로 사용합니다. 상세한 액션 목록과 설정 방법은 [자동화 설정 가이드](AUTOMATION.md#액션-actions)를 참고하세요.


> 순환 호출 방지를 위해 스크립트가 자신을 다시 호출하면 실행이 중단됩니다.

## 실행 기록 (Dashboard)

스크립트 액션 실행 기록은 활동 로그로 저장됩니다. 스크립트 상세보기의 **실행 기록** 탭과 분석 페이지의
활동 로그에서 확인할 수 있으며, 성능 부담을 줄이기 위해 로그 이벤트는 짧게 버퍼링된 뒤 순차 전달될 수 있습니다.
**자동화/스크립트 기록** 카드에서 확인할 수 있으며, 로그 유지(Log retention) 설정의 TTL 기준으로 보관됩니다.
활동 로그에서 자동화/스크립트 로그를 숨기려면 설정 화면의 **활동 로그 → 자동화/스크립트 로그 숨기기** 옵션을
활성화하세요.

## 자동화에서 사용하기

```yaml
automation:
  - id: on_startup
    trigger:
      - type: startup
    then:
      - action: script
        script: warm_start
```

`action: script`와 `script: <id>`를 지정하면 해당 스크립트의 액션 시퀀스가 실행됩니다. 기존 `code` 기반 스크립트 실행은
지원되지 않습니다.

## 커맨드 스키마에서 사용하기

엔티티의 `command_*` 스키마 대신 스크립트를 지정하면 MQTT나 REST를 통해 명령이 호출될 때 패킷 전송 대신 스크립트를 실행합니다.

```yaml
light:
  - id: hallway_scene
    name: Hallway Scene
    command_on:
      script: warm_start
    command_off:
      script: cool_down
```

위 예시에서 `hallway_scene`의 `command_on`이 호출되면 `warm_start` 스크립트가 실행되고, 실제 시리얼 패킷은 전송되지 않습니다.

## 유효성 검증 규칙

- `scripts`는 배열이어야 하며, 각 항목은 객체여야 합니다.
- 각 스크립트에는 비어 있지 않은 `id` 문자열과 하나 이상의 `actions`가 필요합니다.
- 동일한 `id`를 가진 스크립트가 중복될 경우 설정 검증 단계에서 오류가 발생합니다.

## 변수 전달 (Arguments)

스크립트를 호출할 때 `args` 필드를 통해 변수를 전달할 수 있으며, 스크립트 내에서는 CEL(`args.변수명`)을 통해 값을 참조할 수 있습니다.
`command` 액션의 인자, `if`, `wait_until` 등의 조건식에서 `args`를 사용할 수 있습니다.

### 호출 방법

`automation` 또는 다른 `script`에서 호출할 때 `args`를 지정합니다. `args`의 값으로는 고정된 값뿐만 아니라 CEL 표현식도 사용할 수 있어, 현재 상태(`states`)나 트리거 정보(`trigger`)를 기반으로 동적인 값을 전달할 수 있습니다.

```yaml
automation:
  - id: set_temperature_dynamic
    trigger:
      - type: startup
    then:
      - action: script
        script: apply_temp
        args:
          target_temp: 24
          mode: heating
          # CEL을 사용하여 동적 값 전달 가능
          is_active: "has(states.climate_main.state) && states.climate_main.state == 'ON'"
```

### 스크립트 정의에서 사용

```yaml
scripts:
  - id: apply_temp
    description: "가변 온도를 설정하는 스크립트"
    actions:
      - action: command
        target: id(climate_livingroom).command_temperature(args.target_temp)
      - action: if
        condition: args.mode == 'heating'
        then:
          - action: command
            target: id(climate_livingroom).command_heat()
```
