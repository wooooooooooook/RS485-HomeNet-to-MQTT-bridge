# LG LGAP RS485

LG의 HVAC ODU/IDU 통신에 사용되는 **LGAP(LG Air Conditioner Protocol)**를 Homenet2MQTT에서 구성하기 위한 예제입니다.

이 설정은 공개된 [`jourdant/esphome-lgap`](https://github.com/jourdant/esphome-lgap)의 프로토콜 분석을 기반으로 합니다.

## 통신 조건

- RS485
- 4800 bps
- 8 data bits
- No parity
- 1 stop bit
- 상태 응답: 16 bytes
- 제어 요청: 8 bytes
- 체크섬: 체크섬 바이트를 제외한 전체 프레임의 XOR 결과에 `0x55`를 최종 XOR

프로토콜 분석 문서에 따르면 ODU는 자발적으로 상태를 보내지 않으므로 zone별 polling이 필요합니다.

## Homenet2MQTT 기본 설정

```yaml
homenet_bridge:
  packet_defaults:
    rx_header: [0x10]
    tx_header: [0x80]
    rx_length: 16
    rx_checksum: xor_final(0x55)
    tx_checksum: xor_final(0x55)
```

Homenet2MQTT의 `xor_final(0x55)`는 체크섬 범위의 바이트를 XOR한 뒤 `0x55`를 한 번 더 XOR합니다. 기본 RX/TX 체크섬 범위에는 각각 프레임 헤더가 포함되며 체크섬 바이트 자체는 계산에 포함되지 않습니다. 자세한 내용은 `docs/config/xor-final-checksum.md`를 참고하세요.

`tx_header`는 `esphome-lgap`의 현재 예제 설정에서 사용하는 `0x80`으로 잡았습니다. LGAP 프로토콜 문서에서는 TX0가 configurable이라고 설명하므로, 실제 설치 환경에서 캡처한 프레임과 일치하는지 확인해야 합니다.

## RX 상태 프레임

```text
10 status A0 ?? zone error mode|fan target room pipe_in pipe_out active_load power_flag design_load total_load checksum
```

주요 필드는 다음과 같습니다.

| Byte | 의미 | 디코딩 |
|---:|---|---|
| 1 | Power / connected / lock / plasma | bit 0 = power |
| 2 | Request echo | 보통 `0xA0` |
| 4 | Zone | zone 번호 |
| 5 | Error | 0 = 정상 |
| 6 | Mode + fan | mode bits 0-2, fan bits 4-6 |
| 7 | Target temperature | `(data[7] & 0x0F) + 15` °C |
| 8 | Room temperature | `(192 - data[8]) / 3` °C |
| 9 | Pipe-in temperature | `(192 - data[9]) / 3` °C |
| 10 | Pipe-out temperature | `(192 - data[10]) / 3` °C |
| 11 | Zone active load | 0-255 |
| 12 | Zone power state | 0 = running, 1 = off/idle |
| 13 | Zone design load | 0-255 |
| 14 | ODU total load | 0-255 |

## TX 제어 프레임

```text
80 00 A0 zone ON|EXE|lock|plasma mode|fan target checksum
```

- `TX4 bit0`: ON
- `TX4 bit1`: EXE/Write
- `TX4 bit2`: control lock
- `TX4 bit4`: plasma
- `TX5 bits 0-2`: mode
- `TX5 bits 4-6`: fan speed
- `TX6`: target temperature - 15

예를 들어 zone 0을 22°C 냉방/자동풍으로 켜는 요청의 payload는 다음 형태가 됩니다.

```text
80 00 A0 00 03 40 07 ??
```

마지막 `??`는 앞의 7바이트를 XOR한 결과에 `0x55`를 최종 XOR한 값입니다.

## 갤러리

Homenet2MQTT 갤러리에서 다음 스니펫을 사용할 수 있습니다.

- `lgap/climate.yaml` — zone별 LG 에어컨 Climate 엔티티
- `lgap/sensors.yaml` — 에러/배관온도/부하 진단 센서
- `lgap/requirements.json` — 4800 8N1, 프레임 길이 및 LGAP checksum 요구사항

> 주의: `jourdant/esphome-lgap`의 문서에는 모델/설치 환경에 따라 TX0가 configurable하다고 명시되어 있습니다. 실제 RS485 캡처가 있다면 TX header, zone addressing, fan/mode 값 등을 먼저 검증하는 것을 권장합니다.
