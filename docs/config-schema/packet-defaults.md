# Packet Defaults 스키마 작성법

`homenet_bridge.packet_defaults`는 모든 엔티티가 공통으로 사용하는 패킷 프레임 규칙과 시간 제어 값을 정의합니다. 헤더/푸터, 체크섬, 타임아웃을 한 번에 지정해 중복을 줄이고, 개별 엔티티 블록에서 필요할 때만 오버라이드합니다.

## 필드 목록
- `rx_header` / `tx_header`: 수신·송신 패킷 앞부분 식별 바이트 배열.
- `rx_footer` / `tx_footer`: 패킷 종료 시그널.
- `rx_checksum` / `tx_checksum`: 기본 1바이트 체크섬 계산기 (알고리즘 이름 문자열 또는 CEL 표현식).
- `rx_checksum2` / `tx_checksum2`: 이중(2바이트) 체크섬 계산기 (알고리즘 이름 문자열 또는 CEL 표현식).
- `rx_length`: 고정 길이 패킷일 때 전체 길이를 명시.
- `rx_min_length`: 최소 수신 길이. 이보다 짧은 패킷은 무시.
- `rx_max_length`: 최대 수신 길이. 이보다 긴 패킷은 무시.
- `rx_length_expr`: 동적 패킷 길이 계산을 위한 CEL 표현식(선택). 패킷에 패킷 길이 정보가 있는경우 성능향상에 도움이됩니다. 0을 반환하면 Checksum Sweep fallback.
- `rx_valid_headers`: 유효한 패킷 시작 바이트 목록(선택). 체크섬이 유효해도 첫 바이트가 이 목록에 없으면 패킷으로 인식하지 않음.
- `tx_delay`: 재전송 간격 대기 시간 (ms).
- `tx_retry_cnt`: 명령 전송 실패 시 재시도 횟수.
- `tx_timeout`: 명령 패킷 전송 후 응답 대기 시간 (ms).
- `rx_timeout`: 상태 패킷 수신 대기 시간 (ms).

## 전송 제어 파라미터 상세 (Transmission Control Parameters)

명령 패킷을 전송할 때 `tx_timeout`, `tx_retry_cnt`, `tx_delay`가 어떻게 상호작용하는지 설명합니다.

1. **tx_timeout (응답 대기 시간)**
   - 명령 패킷을 전송한 직후부터 응답(ACK 패킷 또는 상태 변경 이벤트)을 기다리는 최대 시간입니다.
   - 이 시간 내에 응답이 오지 않으면 해당 시도는 실패로 간주됩니다.
   - 기본값: `100ms`

2. **tx_retry_cnt (재시도 횟수)**
   - 최초 전송이 `tx_timeout`으로 인해 실패했을 때, 추가로 재시도할 횟수를 지정합니다.
   - 예를 들어 `tx_retry_cnt: 3`으로 설정하면, 최초 1회 + 재시도 3회 = **총 4회**까지 전송을 시도합니다.
   - 기본값: `5회`

3. **tx_delay (재전송 간격)**
   - 전송 실패가 확정된 후, 다음 재시도를 하기 전까지 대기하는 시간입니다.
   - 즉, `전송 -> (타임아웃) -> 실패 -> [tx_delay 대기] -> 재전송` 순서로 진행됩니다.
   - 기본값: `50ms`

> **참고**: `tx_delay`는 재전송 사이의 간격일 뿐, 서로 다른 명령 패킷 사이의 최소 간격(Inter-frame gap)을 의미하지는 않습니다.

## 지원하는 체크섬 알고리즘 (Supported Checksum Algorithms)

패킷 무결성 검증을 위한 체크섬 알고리즘을 문자열로 지정할 수 있습니다. 아래 목록에 없는 복잡한 로직은 CEL 표현식으로 직접 구현해야 합니다.

### 1바이트 체크섬 (`rx_checksum` / `tx_checksum`)

| 알고리즘 (값) | 범위 | 계산 로직 (Pseudo-code) |
| :--- | :--- | :--- |
| `add` | 헤더 + 데이터 | `Sum(All Bytes) & 0xFF` |
| `add_no_header` | 데이터 | `Sum(Data Bytes) & 0xFF` |
| `xor` | 헤더 + 데이터 | `XOR(All Bytes)` |
| `xor_no_header` | 데이터 | `XOR(Data Bytes)` |
| `samsung_rx` (Deprecated) | 데이터 | 초기값 `0xB0`.<br>1. `crc = 0xB0 ^ XOR(Data)`<br>2. 만약 `data[0] < 0x7C`이면, `crc ^= 0x80` |
| `samsung_tx` (Deprecated) | 데이터 | 초기값 `0x00`.<br>`crc = 0x00 ^ XOR(Data) ^ 0x80` |
| `samsung_xor` | 패킷 전체 | 모든 바이트를 XOR한 후 최상위 비트를 0으로 설정 (`crc & 0x7F`) |
| `bestin_sum` | 헤더 + 데이터 | 초기값 `3`.<br>각 바이트 `b`에 대해: `sum = ((b ^ sum) + 1) & 0xFF` |
| `none` | - | 체크섬 검사를 하지 않음 |

### 2바이트 체크섬 (`rx_checksum2` / `tx_checksum2`)

| 알고리즘 (값) | 범위 | 계산 로직 (Pseudo-code) |
| :--- | :--- | :--- |
| `xor_add` | 헤더 + 데이터 | 1. `xor_sum = XOR(All Bytes)`<br>2. `add_sum = Sum(All Bytes)`<br>3. `final_add = (add_sum + xor_sum) & 0xFF`<br>결과: `[xor_sum, final_add]` (2바이트 배열) |

> **참고**: 체크섬 필드에 알고리즘 이름 대신 CEL 표현식을 작성하면 커스텀 로직을 적용할 수 있습니다.
> 예: `rx_checksum: "data[0] + data[1]"`
>
> **사용 가능한 컨텍스트 변수**:
> * `data`: 패킷 데이터 (List of int, 헤더 포함)
> * `len`: 패킷 길이 (int)
> * 상세 내용은 [CEL 가이드](../CEL_GUIDE.md#6-체크섬-계산-rx_checksum-tx_checksum)를 참고하세요.

### 체크섬 문제 해결 (Troubleshooting)

체크섬 검증이 실패하여 패킷이 수신되지 않는 경우 다음 단계를 확인하세요.

1.  **로그 확인**: 로그 레벨을 `debug`로 설정하고 `Raw Packet` 로그를 확인하여 수신되는 패킷의 실제 바이트 값을 캡처합니다.
2.  **알고리즘 검증**: 위 표의 로직을 사용하여 수동으로 체크섬을 계산해 봅니다.
3.  **CEL 활용**: 표준 알고리즘과 미묘하게 다른 경우(예: 오프셋 차이, 초기값 차이), CEL 표현식을 사용하여 정확한 로직을 구현합니다.
    ```yaml
    # 예: XOR 체크섬인데 결과에 0xFF를 XOR 하는 변종
    rx_checksum: "bitXor(bitXor(data[0], data[1]), 0xFF)"
    ```

> [!TIP]
> 체크섬 계산 결과로 리스트(예: 2바이트 체크섬)를 반환하는 경우, 리스트 내 모든 요소의 타입이 일치해야 합니다. 동적 값(`dyn`)이 포함된다면 `int()`로 캐스팅하세요. (참고: [CEL 가이드](../CEL_GUIDE.md#자주-발생하는-문제와-팁-troubleshooting))

## 기본 예제 (양방향 동일 헤더/푸터)
`kocom.homenet_bridge.yaml`은 동일한 헤더·푸터와 단순 합산 체크섬을 사용합니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_timeout: 10ms
    tx_delay: 50ms
    tx_timeout: 500ms
    tx_retry_cnt: 3
    rx_header: [0xAA, 0x55]
    rx_footer: [0x0D, 0x0D]
    tx_header: [0xAA, 0x55]
    tx_footer: [0x0D, 0x0D]
    rx_checksum: add_no_header
    tx_checksum: add_no_header
```

## 방향별 헤더/체크섬이 다른 예제
`cvnet.homenet_bridge.yaml`처럼 수신·송신 헤더가 같더라도 푸터와 체크섬 로직이 다를 수 있습니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_header: [0xF7]
    rx_footer: [0xAA]
    rx_checksum: add_no_header
    tx_header: [0xF7]
    tx_footer: [0xAA]
    tx_checksum: add_no_header
```

## 이중 체크섬 예제
`ezville.homenet_bridge.yaml`은 XOR+합산 방식의 보조 체크섬을 사용합니다. 기본 체크섬이 없을 때 `rx_checksum`를 생략하고 `rx_checksum2`만 둘 수도 있습니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_header: [0xF7]
    tx_header: [0xF7]
    rx_checksum2: xor_add
    tx_checksum2: xor_add
```

## 브랜드별 커스텀 계산기 예제
`samsung_sds.homenet_bridge.yaml`은 전용 체크섬 함수와 유효 헤더 검증을 사용합니다. `rx_valid_headers`는 체크섬 충돌로 인한 잘못된 패킷 인식을 방지합니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_checksum: samsung_xor
    tx_checksum: samsung_xor
    rx_valid_headers: [0xB0, 0xAD, 0xCC, 0xA4]
```

## 동적 패킷 길이 계산 (`rx_length_expr`)

패킷 내 특정 바이트가 길이를 나타내지만, 모든 패킷에 적용되지 않는 경우 CEL 표현식을 사용합니다.

> [!NOTE]
> `rx_length_expr`은 `rx_length`나 `rx_footer`가 없을 때(Strategy C: Checksum Sweep)만 적용됩니다.
> `rx_length`가 함께 정의되면 무시되며 경고 로그가 출력됩니다.

### 사용 예시: Bestin

Bestin 패킷 구조:
- `data[0]`: 헤더 (0x02)
- `data[1]`: 디바이스 ID
- `data[2]`: 패킷 길이 (일부 디바이스에서만 유효)

```yaml
homenet_bridge:
  packet_defaults:
    rx_header: [0x02]
    rx_checksum: bestin_sum

    # offset 1이 0x28(난방) 또는 0x2E(가스밸브)일 때만 offset 2가 길이
    # 조명(0x3x), 환기팬(0x61) 등은 0 반환 → Checksum Sweep fallback
    rx_length_expr: "data[1] == 0x28 || data[1] == 0x2E ? data[2] : 0"
```

### CEL 표현식 규칙

**사용 가능한 컨텍스트 변수:**
*   `data`: 현재 수신 버퍼 데이터 (List of int).
*   `len`: 현재 수신 버퍼의 남은 길이 (int).

| 반환값 | 동작 |
|--------|------|
| `> 0` | 해당 길이로 체크섬 검증 후 패킷 추출 |
| `0` 또는 음수 | Checksum Sweep fallback (모든 길이 순회) |
| 버퍼 길이 초과 | 더 많은 데이터 대기 |

## 작성 팁
1. 헤더/푸터와 체크섬 계산 규칙을 모르면 우선 패킷 캡처를 진행한 뒤, 동일한 구간을 `state.data`로 맞춰 넣으세요.
2. 엔티티마다 특이 규칙이 있을 경우 해당 엔티티 블록 안에 `packet_defaults`를 중첩해 일부 값만 덮어쓰면 됩니다.
3. 타임아웃과 지연은 장비 응답 속도에 맞춰 조정하되, 과도하게 짧으면 재전송이 반복되고 길면 UI 반응이 느려집니다.
