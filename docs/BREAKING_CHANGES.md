# 2.0.0 Breaking Change: StateNumSchema Offset 일관성 수정

## 변경 사항 요약

`StateNumSchema`의 `offset` 필드가 이제 **헤더를 포함한 전체 패킷 기준**으로 계산됩니다. 이전에는 헤더를 제외한 payload 기준으로 계산되었습니다.

## **영향 범위**
 `rx_header`길이가 0이 아니고(commax, samsumg_sds외 모든 제조사), state_* 속성에 (`StateNumSchema` 기반) 포함된 `offset`
 
 (CEL로 작성된 경우(data[9]와 같은 형식) 원래 헤더를 포함하여 계산되고있었습니다. schema기반으로 작성된 경우만 수정이 필요합니다.)

## 영향 받는 설정 필드

`StateNumSchema`를 사용하는 모든 `state_*` 속성:

| 엔티티 타입 | 영향 받는 필드 |
|------------|--------------|
| climate | `state_temperature_current`, `state_temperature_target` |
| fan | `state_speed`, `state_percentage` |
| light | `state_brightness`, `state_color_temp`, `state_red`, `state_green`, `state_blue`, `state_white` |
| number, sensor | `state_number` |
| valve | `state_position` |

## 마이그레이션 방법 (권장)

> [!TIP]
> **가장 간단한 방법**: Gallery에서 모든 설정을 업데이트하세요!

Gallery 스니펫들은 이미 이 변경에 맞게 업데이트되었습니다. (수작업이기 때문에 그래도 오류가 있을걸로 생각됩니다. 오류가 있으면 알려주세요!)

### UI에서 Gallery 업데이트 방법

1. 설정 편집기에서 **Gallery** 탭 열기
2. 사용 중인 스니펫 선택
3. **적용** 버튼 클릭
4. 변경 사항 저장

### 수동 수정 (Gallery를 사용하지 않는 경우)

오류가 발생한 (상태 업데이트가 되지 않거나 상태값이 이상한경우)
state_*에 있는 `offset` 값에 `rx_header` 길이를 더해주세요.

#### 예시: rx_header가 1바이트인 경우

```yaml
# 수정 전 (기존)
packet_defaults:
  rx_header: [0xF7]

climate:
  - id: heater1
    state_temperature_current:
      offset: 5  # payload[5]를 가리켰음
    state_temperature_target:
      offset: 6  # payload[6]를 가리켰음
```

```yaml
# 수정 후
packet_defaults:
  rx_header: [0xF7]

climate:
  - id: heater1
    state_temperature_current:
      offset: 6  # packet[6] = 이전 payload[5]
    state_temperature_target:
      offset: 7  # packet[7] = 이전 payload[6]
```

## 변경 이유

이전에는 `StateSchema`(패킷 매칭용)와 `StateNumSchema`(값 추출용)의 `offset` 동작이 달랐습니다:

| 스키마 | 이전 동작 | 변경 후 |
|-------|----------|--------|
| StateSchema | 헤더 포함 전체 패킷 기준 | 동일 (변경 없음) |
| StateNumSchema | ❌ payload 기준 (헤더 제외) | ✅ 헤더 포함 전체 패킷 기준 |
| CEL `data[N]` | 헤더 포함 전체 패킷 기준 | 동일 (변경 없음) |

또한 state_*의 offset이 헤더를 포함하기도 하고 안하기도 한 상태로 혼재되어있었습니다. (오류 제보가 없었기 때문에..?)

이제 모든 `offset`이 일관되게 **전체 패킷 기준**으로 동작합니다. (offset: 0은 헤더를 가리키게됩니다.)


## 도움이 필요한 경우

설정 파일 마이그레이션에 도움이 필요하면 [GitHub Issues](https://github.com/wooooooooooook/homenet2mqtt/issues) 또는 [Discord](https://discord.gg/kGwhUBMe5z) 로 문의주세요.

설정파일(default.homenet_bridge.yaml)과 분석페이지의 `패킷딕셔너리`를 복사해서 보내주시면 큰 도움이 됩니다.
