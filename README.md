# RS485 HomeNet to MQTT Bridge

This project is a bridge that connects RS485-based HomeNet devices to an MQTT broker, allowing them to be controlled and monitored via Home Assistant.

## Configuration

The configuration is done via a YAML file located in `packages/core/config/`. You can create a new file or modify one of the existing examples.

### `homenet_bridge`

This is the root of the configuration.

```yaml
homenet_bridge:
  serial:
    baud_rate: 9600
    data_bits: 8
    parity: NONE
    stop_bits: 1
  
  device_config:
    name: 'My Wallpad'
    rx_timeout: 10ms
    tx_delay: 50ms
    # ... other device_config parameters
    
  light:
    # ... light entities
    
  climate:
    # ... climate entities
```

### `serial`

This section configures the serial port.

- `baud_rate` (Required, int): The baud rate of the serial port.
- `data_bits` (Optional, int): The number of data bits. Defaults to 8.
- `parity` (Optional, string): The parity of the serial port. Can be `NONE`, `EVEN`, `ODD`. Defaults to `NONE`.
- `stop_bits` (Optional, int): The number of stop bits. Defaults to 1.

### `device_config`

This section contains the general configuration for the RS485 device.

- `name` (Required, string): The name of the device.
- `rx_timeout` (Optional, Time): Data Receive Timeout. Defaults to 10ms. Max 2000ms.
- `rx_length` (Optional, int): The length of the received data when the data length is fixed. Max 256.
- `tx_delay` (Optional, Time): Data Send Delay. Defaults to 50ms. Max 2000ms.
- `tx_timeout` (Optional, Time): ACK Reception Timeout. Defaults to 50ms. Max 2000ms.
- `tx_retry_cnt` (Optional, int): Retry Count on ACK Failure. Defaults to 3. Max 10.
- `rx_header` (Optional, array): Header of Data to be Received.
- `rx_footer` (Optional, array): Footer of Data to be Received.
- `tx_header` (Optional, array): Header of Data to be Transmitted.
- `tx_footer` (Optional, array): Header of Data to be Transmitted.
- `rx_checksum` (Optional, enum, lambda): Checksum of Data to be Received. (add, xor, add_no_header, xor_no_header).
- `tx_checksum` (Optional, enum, lambda): Checksum of Data to be Transmitted. (add, xor, add_no_header, xor_no_header).

---

## Schemas

### State Schema

```yaml
state: 
  data: [0x01, 0x02]
  mask: [0xff, 0xff]
  offset: 0
  inverted: False
```

- `data` (Required, array or string): The data to match in the received packet.
- `mask` (Optional, array or string): A mask to apply to the received data before comparison.
- `offset` (Optional, int): The offset in the received packet where the data should be matched. Defaults to 0.
- `inverted` (Optional, bool): Whether the logic should be inverted. Defaults to False.

### Command Schema

```yaml
command_on: 
  data: [0x01, 0x02, 0x01]
  ack: [0xff]
```

- `data` (Required, array or string): The data to send.
- `ack` (Optional, array or string): The expected ACK response.

### State Num Schema

```yaml
state_temperature_current:
  offset: 2
  length: 1
  precision: 0
```

- `offset` (Required, int): The offset in the received packet where the number is located.
- `length` (Optional, int): The length of the number in bytes. Defaults to 1.
- `precision` (Optional, int): The number of decimal places. Defaults to 0.
- `signed` (Optional, bool): Whether the number is signed. Defaults to True.
- `endian` (Optional, enum): The endianness of the number. Can be "big" or "little". Defaults to "big".
- `decode` (Optional, enum): How to decode the number. Can be "none", "bcd", or "ascii". Defaults to "none".

---

## Components

### `light`

```yaml
light:
  - name: "Room 0 Light 1"
    state: 
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]
    command_on:
      data: [0x02, 0x03, 0x01]
      ack: [0x02, 0x13, 0x01]
    command_off: !lambda |-
      return {{0x02, 0x03, 0x00}, {0x02, 0x13, 0x00}};
```

### `binary_sensor`

```yaml
binary_sensor:
  - name: "Door Sensor"
    state: 
      data: [0x02, 0x03]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]
```

### `button`

```yaml
button:
  - name: "Elevator Call"
    icon: "mdi:elevator"
    command_on: 
      data: [0x02, 0x03, 0x01]
```

### `climate`

```yaml
climate:
  - name: "Room 0 Heater"
    visual:
      min_temperature: 5 °C
      max_temperature: 30 °C
      temperature_step: 1 °C
    state: 
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    state_temperature_current:
      offset: 4
    state_temperature_target:
      offset: 3
    state_off:
      offset: 2
      data: [0x00]
    state_heat:
      offset: 2
      data: [0x01]
    command_off:
      data: [0x02, 0x03, 0x00]
      ack: [0x02, 0x13, 0x00]
    command_heat: !lambda |-
      uint8_t target = id(room_0_heater).target_temperature;
      return {{0x02, 0x03, 0x01, (uint8_t)target, 0x00},{0x02, 0x13, 0x01}};
    command_temperature: !lambda |-
      uint8_t target = x;
      return {{0x02, 0x03, 0x01, (uint8_t)target, 0x00},{0x02, 0x13, 0x01}};
```

### `fan`

```yaml
fan:
  - name: "Fan1"
    state:
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]
    command_on:
      data: [0x02, 0x03, 0x01]
      ack: [0x02, 0x13]
    command_off:
      data: [0x02, 0x03, 0x00]
      ack: [0x02, 0x13]
    command_speed: !lambda |-
      return {{0x02, 0x03, 0x01, (uint8_t)x},{0x02, 0x13}};
    state_speed: !lambda |-
      return data[3];
```

### `lock`

```yaml
lock:
  - name: "Door Lock"
    state:
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    state_locked:
      offset: 2
      data: [0x01]
    state_unlocked:
      offset: 2
      data: [0x00]
    command_lock:
      data: [0x02, 0x03, 0x01]
      ack: [0x02, 0x13]
    command_unlock:
      data: [0x02, 0x03, 0x00]
      ack: [0x02, 0x13]
```

### `number`

```yaml
number:
  - name: "My Number"
    state:
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    max_value: 10
    min_value: 1
    step: 1
    state_number:
      offset: 3
    command_number: !lambda |-
      return {{0x02, 0x03, 0x00, (uint8_t)x},{0x02, 0x13}};
```

### `sensor`

```yaml
sensor:
  - name: "Temperature"
    state: 
      data: [0x02, 0x03, 0x00]
    state_number:
      offset: 3
```

### `switch`

```yaml
switch:
  - name: "My Switch"
    state: 
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    state_on:
      offset: 2
      data: [0x01]
    state_off:
      offset: 2
      data: [0x00]
    command_on:
      data: [0x02, 0x03, 0x01]
      ack: [0x02, 0x13, 0x01]
    command_off: !lambda |-
      return {{0x02, 0x03, 0x00}, {0x02, 0x13, 0x00}};
```

### `select`

```yaml
select:
  - name: "My Select"
    state: 
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    options:
      - "One"
      - "Two"
    command_select: !lambda |-
      if (str == "Two") return {{0x02, 0x03, 0x00}, {0x02, 0x13, 0x00}};
      return {{0x02, 0x03, 0x01}, {0x02, 0x13, 0x01}};
    state_select: !lambda |-
      if (data[2] == 0x01) return "One";
      return "Two";
```

### `text_sensor`

```yaml
text_sensor:
  - name: "My Text Sensor"
    state: 
      data: [0x02, 0x03]
    lambda: |-
      if (data[2] == 0x01) return "ON";
      return "OFF";
```

### `valve`

```yaml
valve:
  - name: "My Valve"
    state: 
      data: [0x02, 0x03]
      mask: [0xff, 0x0f]
    state_open:
      offset: 2
      data: [0x01]
    state_closed:
      offset: 2
      data: [0x00]
    command_open:
      data: [0x02, 0x03, 0x01]
      ack: [0x02, 0x13, 0x01]
    command_close:
      data: [0x02, 0x03, 0x00]
      ack: [0x02, 0x13, 0x00]
```