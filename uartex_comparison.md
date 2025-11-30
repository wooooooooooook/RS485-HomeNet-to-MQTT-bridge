# `uartex` vs. homenet-bridge 기능 비교

이 문서는 ESPHome의 `uartex` 컴포넌트와 현재 `homenet-bridge` 애플리케이션의 기능 차이를 비교하고, `homenet-bridge`에 아직 구현되지 않은 기능 목록을 정리합니다.

## 1. 근본적인 아키텍처 차이

가장 큰 차이점은 두 프로젝트의 실행 환경과 통신 방식입니다.

- **`uartex`**: ESPHome 프레임워크 위에서 동작하는 컴포넌트입니다. 따라서 UART 포트를 직접 제어하고 GPIO 핀을 조작하는 등 하드웨어에 직접 접근합니다. 모든 설정은 Home Assistant와 통합된 YAML 파일을 통해 이루어집니다.
- **`homenet-bridge`**: 독립적인 Node.js 애플리케이션입니다. UART 디바이스(시리얼 포트 또는 TCP 소켓)와 MQTT 브로커 사이를 중개하는 '브릿지' 역할을 합니다. ESPHome을 사용하지 않으며, MQTT를 통해 Home Assistant나 다른 스마트홈 플랫폼과 연동됩니다.

## 2. 구현되지 않은 기능 목록

### 2.1. 프로토콜 레벨 (Protocol Level)

`uartex`는 신뢰성 있고 유연한 시리얼 통신을 위해 다양한 저수준(low-level) 기능을 제공하지만, 현재 `homenet-bridge`에는 대부분 구현되어 있지 않습니다.

- **ACK/재시도 메커니즘 부재:**
  - `uartex`는 `tx_timeout`, `tx_retry_cnt`, `ack` 필드를 통해 커맨드 전송 후 ACK(응답) 패킷을 기다리고, 수신 실패 시 지정된 횟수만큼 재전송하는 기능이 있습니다. 이는 통신의 신뢰성을 크게 높여줍니다.
  - `homenet-bridge`에는 현재 이러한 ACK 처리 및 재시도 로직이 없습니다.

- **다양한 체크섬(Checksum) 알고리즘 미지원:**
  - `uartex`는 `add`, `xor`, 헤더 제외 옵션(`add_no_header`), 2바이트 체크섬(`rx_checksum2`) 등 여러 체크섬 계산 방식을 지원합니다.
  - `homenet-bridge`의 체크섬 구현은 상대적으로 기본적인 수준에 머물러 있습니다.

- **세분화된 통신 타이밍 제어 부재:**
  - `uartex`는 `tx_delay` 설정을 통해 패킷 전송 간 최소 지연 시간을 강제하여, 응답이 느린 장치와의 통신 안정성을 확보할 수 있습니다.
  - `homenet-bridge`에는 이러한 장치별 타이밍 제어 기능이 없습니다.

- **GPIO 핀 제어 (`tx_ctrl_pin`) 부재:**
  - `uartex`는 RS485 통신 등에서 송/수신 모드 전환에 사용되는 컨트롤 GPIO 핀을 직접 제어할 수 있습니다. `homenet-bridge`는 하드웨어와 분리되어 있어 이 기능이 없습니다.

### 2.2. 장치(Entity) 기능 레벨

`homenet-bridge`는 `uartex`가 지원하는 대부분의 장치 유형(light, climate, fan 등)의 기본적인 상태 파싱 및 커맨드 전송은 지원하지만, `uartex`가 제공하는 풍부한 세부 기능들은 상당수 누락되어 있습니다.

- **`climate` (온도 조절 장치):** 가장 기능 차이가 큰 컴포넌트입니다.
  - **팬 모드(Fan Modes):** `state_fan_only`, `state_fan_low/medium/high`, `command_fan_auto` 등 팬의 다양한 모드 및 속도를 제어하는 기능이 전혀 구현되어 있지 않습니다.
  - **스윙 모드(Swing Modes):** `state_swing_vertical`, `state_swing_horizontal`, `command_swing_both` 등 팬의 날개 방향을 제어하는 기능이 없습니다.
  - **프리셋(Presets):** `state_preset_eco`, `state_preset_away`, `command_preset_boost` 등 미리 정의된 설정을 사용하는 프리셋 기능이 없습니다.
  - **습도(Humidity):** `state_humidity_current`, `command_humidity` 등 습도 관련 상태를 읽거나 목표 습도를 설정하는 기능이 없습니다.
  - **세분화된 동작 상태(Action):** `state_action_heating`, `state_action_cooling` 등 장치의 현재 동작 상태를 세밀하게 파악하는 기능이 부족합니다.

- **`fan` (선풍기):**
  - **프리셋 모드(Preset Modes):** `preset_modes` 리스트를 정의하고 `command_preset`으로 제어하는 기능이 없습니다.

- **`lock` (잠금 장치):**
  - **세분화된 상태(States):** `state_locking`(잠그는 중), `state_unlocking`(여는 중), `state_jammed`(걸림)와 같이 잠금 장치의 중간 상태나 오류 상태를 표현하는 기능이 없습니다. `locked`, `unlocked` 두 가지 상태만 지원합니다.

- **`number` (숫자 입력):**
  - `state_increment`, `state_decrement` 등 증감 상태를 나타내는 기능이 없습니다.

- **`valve` (밸브):**
  - `state_position`을 통해 밸브가 열린 정도를 0-100%로 표현하는 기능이 없습니다.

- **전역 `command_update` 미지원:**
  - `uartex`의 많은 컴포넌트는 `command_update`를 지원하여, 장치의 현재 상태를 강제로 폴링(polling)하도록 요청할 수 있습니다. 이 기능은 `homenet-bridge`에 전역적으로 구현되어 있지 않습니다.

## 3. 결론

`homenet-bridge`는 MQTT를 통해 다양한 시리얼 기반 장치를 연동할 수 있는 강력한 기반을 갖추고 있습니다. 하지만 `uartex`와 비교했을 때, 통신의 신뢰성을 보장하는 저수준 프로토콜 기능과 다양한 장치의 고급 제어 기능이 상당수 부족한 상황입니다.

향후 기능 확장을 위해서는 위 목록에 언급된 기능들, 특히 ACK/재시도 로직과 `climate` 장치의 세부 기능 구현을 우선적으로 고려해 볼 수 있습니다.
