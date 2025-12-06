# Home Assistant MQTT Discovery 설정

이 문서는 RS485 브리지를 설정하여 MQTT를 통해 Home Assistant에서 장치를 자동으로 검색(Discovery)할 수 있도록 하는 방법을 설명합니다.

## 개요

이 브리지는 Home Assistant의 MQTT Discovery 프로토콜을 지원합니다. 올바르게 설정하면 `config.yaml`에 정의된 장치가 `configuration.yaml`에 수동으로 설정하지 않아도 Home Assistant에 자동으로 나타납니다.

## 설정

검색 기능을 활성화하려면 `config.yaml`의 엔티티 설정에 특정 속성을 추가할 수 있습니다.

### 공통 속성

모든 엔티티 유형에 대해 다음 속성을 사용할 수 있습니다:

- **`name`**: (필수) 장치의 친숙한 이름입니다.
- **`id`**: (필수) 장치의 고유 식별자입니다 (MQTT 토픽에 사용됨).
- **`type`**: (필수) 엔티티 유형입니다 (예: `switch`, `sensor`, `climate`).
- **`icon`**: (선택) Home Assistant에서 사용할 Material Design 아이콘입니다 (예: `mdi:thermometer`).
- **`discovery_always`**: (선택) `true`일 경우 실제 상태 패킷을 받지 않아도 Discovery를 즉시 발행합니다. 상태 패킷이 없는 버튼/센서 등에 사용합니다.
- **`discovery_linked_id`**: (선택) 지정한 다른 엔티티 ID의 상태를 처음 수신할 때 함께 Discovery를 발행합니다. 같은 장치에 묶인 여러 엔티티를 동시에 노출할 때 활용합니다.

> 기본적으로 각 엔티티는 자신의 상태 패킷을 처음 받을 때까지 Discovery가 지연됩니다. 위 옵션으로 예외를 정의할 수 있습니다.

### 센서 (Sensor) 설정

`sensor` 엔티티의 경우, Home Assistant가 데이터를 이해하는 데 도움이 되는 추가 속성을 지정할 수 있습니다:

- **`device_class`**: (선택) 센서의 유형입니다 (예: `temperature`, `humidity`, `power`). [Home Assistant Device Classes](https://www.home-assistant.io/integrations/sensor/#device-class)를 참조하세요.
- **`unit_of_measurement`**: (선택) 값의 단위입니다 (예: `°C`, `%`, `W`).
- **`state_class`**: (선택) 상태의 유형입니다 (예: `measurement`, `total_increasing`). [Home Assistant State Classes](https://www.home-assistant.io/integrations/sensor/#state-class)를 참조하세요.

#### 예시

```yaml
sensor:
  - id: living_room_temp
    name: "거실 온도"
    type: sensor
    device_class: temperature
    unit_of_measurement: "°C"
    state_class: measurement
    icon: mdi:thermometer
```

### 스위치 / 조명 / 팬 (Switch / Light / Fan) 설정

`switch`, `light`, `fan` 엔티티의 경우, 브리지가 명령 및 상태 토픽을 자동으로 설정합니다.

- **`icon`**: (선택) 사용자 정의 아이콘.

#### 예시

```yaml
switch:
  - id: living_room_light
    name: "거실 조명"
    type: switch
    icon: mdi:lightbulb
```

### 온도 조절기 (Climate) 설정

Climate 엔티티는 기본 모드(`off`, `heat`, `cool`, `fan_only`, `dry`, `auto`)로 자동 설정됩니다.

#### 예시

```yaml
climate:
  - id: master_bedroom_thermostat
    name: "안방 온도조절기"
    type: climate
```

## Discovery 토픽

브리지는 다음 토픽 패턴으로 Discovery 설정을 발행합니다:

`homeassistant/<entity_type>/homenet_<entity_id>/config`

예: `homeassistant/sensor/homenet_living_room_temp/config`

## 문제 해결

장치가 Home Assistant에 나타나지 않는 경우:

1. MQTT가 연결되어 있고 브리지가 `homeassistant` 접두사로 발행하고 있는지 확인하세요.
2. 브리지 로그에서 `[DiscoveryManager] Published discovery config` 메시지를 확인하세요.
3. MQTT 클라이언트(예: MQTT Explorer)를 사용하여 `homeassistant/#` 토픽의 메시지를 확인하세요.
