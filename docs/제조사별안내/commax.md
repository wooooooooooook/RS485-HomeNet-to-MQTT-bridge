## 코맥스
## reference

### 1. Light (조명)

**Command 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | power | empty | empty | empty | empty | checksum |
| **Values** | "31" | "FF" | "01" (on), "00" (off) | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State Request 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | empty | empty | empty | empty | empty | checksum |
| **Values** | "30" | "FF" | - | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | deviceId | empty | empty | empty | empty | checksum |
| **Values** | "B0" | "01" (on), "00" (off) | "FF" | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

### 2. LightBreaker (일괄 소등 스위치)

**Command 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | commandType | power | empty | empty | empty | checksum |
| **Values** | "22" | "FF" | "01" (power) | "01" (on), "00" (off) | - | - | - | - |
| **Memo** | - | - | 추정입니다 | 추정입니다 | - | - | - | - |

**State Request 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | empty | empty | empty | empty | empty | checksum |
| **Values** | "20" | "FF" | - | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | deviceId | empty | empty | unknown | empty | checksum |
| **Values** | "A0" | "01" (on), "00" (off) | "FF" | - | - | "15" | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

### 3. Thermo (온도조절기)

**Command 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | commandType | value | empty | empty | empty | checksum |
| **Values** | "04" | "FF" | "04" (power), "03" (change) | "81" (on), "00" (off), "FF" (target) | - | - | - | - |
| **Memo** | - | - | - | target은 10진수 온도 | - | - | - | - |

**State Request 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | empty | empty | empty | empty | empty | checksum |
| **Values** | "02" | "FF" | - | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | deviceId | currentTemp | targetTemp | empty | empty | checksum |
| **Values** | "82" | "81" (idle), "83" (heating), "80" (off) | "FF" | "FF" | "FF" | - | - | - |
| **Memo** | - | - | - | 16진수가 아닌 10진수 그대로 (24도면 24) | 16진수가 아닌 10진수 그대로 (24도면 24) | - | - | - |

**Ack 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | deviceId | currentTemp | targetTemp | empty | empty | checksum |
| **Values** | "84" | "81" (idle), "83" (heating), "80" (off) | "FF" | "FF" | "FF" | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

### 4. Gas (가스 밸브)

**Command 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | power | empty | empty | empty | empty | checksum |
| **Values** | "11" | "FF" | "80" (off) | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | powerRepeat | empty | empty | empty | empty | checksum |
| **Values** | "90" | "80" (on), "48" (off) | "80" (on), "48" (off) | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

### 5. Outlet (대기전력차단콘센트)

**Command 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | commandType | power | cutoffValue | empty | empty | checksum |
| **Values** | "7A" | "FF" | "01" (power), "02" (ecomode), "03" (setCutoff) | "01" (on), "00" (off) | "FF" | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State Request 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | requrestType | empty | empty | empty | empty | checksum |
| **Values** | "79" | "FF" | "01" (wattage), "02" (ecomode) | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | deviceId | stateType | data1 | data2 | data3 | checksum |
| **Values** | "F9" | "01" (on), "00" (off), "11" (on_with_eco), "10" (off_with_eco) | "FF" | "11" (wattage), "21" (ecomode) | "FF" | "FF" | "FF" | - |
| **Memo** | - | - | - | ecomode는 대기전력차단모드 cutoff value | wattage의 경우 data1~3까지 그대로 읽어서 x scailing factor | ecomode?는 000100 000060이 목격됨 | - | - |

- Wattage scaling factor: 0.1
- Ecomode scaling factor: 1

### 6. Fan (환기장치)

**Command 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | commandType | value | empty | empty | empty | checksum |
| **Values** | "78" | "FF" | "01" (power), "02" (setSpeed) | "00" (off), "01" (low), "02" (medium), "03" (high), "04" (on) | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State Request 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | empty | empty | empty | empty | empty | checksum |
| **Values** | "76" | "FF" | - | - | - | - | - | - |
| **Memo** | - | - | - | - | - | - | - | - |

**State 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | deviceId | speed | empty | empty | empty | checksum |
| **Values** | "F6" | "04" (on), "00" (off) | "FF" | "01" (low), "02" (medium), "03" (high) | - | - | - | - |
| **Memo** | - | 명령에 없는 night, auto가 존재한다고함. | - | - | - | - | - | - |

### 7. EV (엘리베이터 호출)

**Command 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | deviceId | power | unknown1 | unknown2 | unknown3 | empty | checksum |
| **Values** | "FF" | "FF" | "01" (on) | "00" (fixed) | "08" (fixed) | "15" (fixed) | - | - |
| **Memo** | 사실 A0이지만 일괄조명차단기 상태헤더와 중복이라 main.py에 하드코딩되어있음 | 기기 번호로 추정됨.. EV의 헤더는 A0이지만 일괄조명차단기 상태헤더와 중복이라 main.py에 하드코딩되어있음. | 추정됨.. | - | - | - | - | - |

**State 패킷**

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **Name** | Header | power | deviceId | floor | empty | empty | empty | checksum |
| **Values** | "23" | "01" (on) | "FF" | "FF" | - | - | - | - |
| **Memo** | - | power로 추정됨.. | 기기 번호로 추정됨.. | 층으로 추정됨.. | - | - | - | - |
