# Parameterized XOR final checksum

`xor_final(0xNN)` 및 `xor_final_no_header(0xNN)`은 XOR 결과에 설정한 최종 XOR 값을 한 번 더 적용하는 1바이트 체크섬 형식입니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_checksum: xor_final(0x55)
    tx_checksum: xor_final(0x55)
```

## 체크섬 범위

- `xor_final(0xNN)`: 헤더 + 데이터를 XOR한 뒤 `0xNN`을 XOR합니다. 기존 `xor`와 동일하게 체크섬 바이트 자체는 계산 대상에서 제외됩니다.
- `xor_final_no_header(0xNN)`: 헤더를 제외한 데이터만 XOR한 뒤 `0xNN`을 XOR합니다. 기존 `xor_no_header`와 동일한 범위를 사용합니다.

예를 들어 다음 패킷의 체크섬은:

```text
AA 01 02 FC
```

`xor_final(0x55)`를 사용하면:

```text
AA ^ 01 ^ 02 ^ 55 = FC
```

`xor_final_no_header(0x55)`를 사용하면:

```text
01 ^ 02 ^ 55 = 56
```

## 사용 예시

```yaml
homenet_bridge:
  packet_defaults:
    rx_checksum: xor_final(0x55)
    tx_checksum: xor_final(0x55)
```

헤더를 체크섬 계산에서 제외해야 하는 장치는 다음과 같이 설정합니다.

```yaml
homenet_bridge:
  packet_defaults:
    rx_checksum: xor_final_no_header(0x55)
    tx_checksum: xor_final_no_header(0x55)
```

## 동작 및 성능

`xor_final` 계열은 일반 `xor` 체크섬과 동일한 패킷 검색 최적화 경로를 사용합니다. 패킷 스트림에서 후보 위치가 이동할 때 XOR 값을 매번 전체 패킷에 대해 다시 계산하지 않고 기존 sliding-window 방식으로 갱신하며, 설정된 최종 XOR 값은 각 후보의 체크섬 비교 단계에서만 적용합니다.

따라서 `xor_final`을 사용하기 위해 별도의 전체 체크섬 재계산이나 일반적인 느린 fallback 처리가 필요하지 않습니다.

예:

- `xor_final(0x55)` → `XOR(header + data) ^ 0x55`
- `xor_final_no_header(0x55)` → `XOR(data) ^ 0x55`
- `xor_final(0x00)` → `xor`와 동일
- `xor_final_no_header(0x00)` → `xor_no_header`와 동일

최종 XOR 값은 정확히 두 자리의 16진수로 작성해야 합니다(`0x00` ~ `0xff`).
