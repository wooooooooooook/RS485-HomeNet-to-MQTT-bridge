# Checksum Algorithms Reference

This document details the mathematical operations for the checksum algorithms supported by the bridge. These can be used in the `rx_checksum`, `tx_checksum`, `rx_checksum2`, and `tx_checksum2` configuration fields.

## 1-Byte Checksums

These algorithms produce a single byte (0-255) as the checksum.

### `add`
Calculates the sum of all bytes in the packet (header + data) modulo 256.

**Formula:**
`Sum(Header + Data) & 0xFF`

**Example:**
- Header: `[0x02]`
- Data: `[0x10, 0x01]`
- Calculation: `0x02 + 0x10 + 0x01 = 0x13`
- Result: `0x13`

### `add_no_header`
Calculates the sum of data bytes only (excluding header) modulo 256.

**Formula:**
`Sum(Data) & 0xFF`

**Example:**
- Header: `[0x02]` (Ignored)
- Data: `[0x10, 0x01]`
- Calculation: `0x10 + 0x01 = 0x11`
- Result: `0x11`

### `xor`
Calculates the bitwise XOR of all bytes in the packet (header + data).

**Formula:**
`XOR(Header + Data)`

**Example:**
- Header: `[0x02]`
- Data: `[0x10, 0x01]`
- Calculation: `0x02 ^ 0x10 ^ 0x01 = 0x13`
- Result: `0x13`

### `xor_no_header`
Calculates the bitwise XOR of data bytes only.

**Formula:**
`XOR(Data)`

**Example:**
- Header: `[0x02]` (Ignored)
- Data: `[0x10, 0x01]`
- Calculation: `0x10 ^ 0x01 = 0x11`
- Result: `0x11`

### `samsung_rx`
A custom algorithm used for Samsung SDS wallpad receive packets.

**Logic:**
1. Initialize `crc` with `0xB0`.
2. XOR `crc` with all data bytes (header is excluded/handled separately).
3. **Magic Byte:** If the first byte of data is less than `0x7C`, XOR the result with `0x80`.

**Formula:**
```javascript
let crc = 0xB0;
for (const byte of data) {
  crc ^= byte;
}
if (data[0] < 0x7C) {
  crc ^= 0x80;
}
```

### `samsung_tx`
A custom algorithm used for Samsung SDS wallpad transmit packets.

**Logic:**
1. Initialize `crc` with `0x00`.
2. XOR `crc` with all data bytes.
3. XOR the final result with `0x80`.

**Formula:**
`XOR(Data) ^ 0x80`

---

## 2-Byte Checksums

These algorithms produce two bytes (16 bits) as the checksum. Configure using `rx_checksum2` and `tx_checksum2`.

### `xor_add`
A hybrid algorithm that maintains both a running sum (`add`) and a running XOR (`temp`).

**Logic:**
1. Initialize `crc` (sum) and `temp` (xor) to 0.
2. For each byte in (Header + Data):
   - `crc += byte`
   - `temp ^= byte`
3. Add the final `temp` value to the `crc` accumulator: `crc += temp`.
4. **Result High Byte:** `temp & 0xFF`
5. **Result Low Byte:** `crc & 0xFF`

**Example:**
- Input (Header+Data): `[0x7A, 0x01, 0x23]`
- Iteration 1 (0x7A): `crc`=0x7A, `temp`=0x7A
- Iteration 2 (0x01): `crc`=0x7B, `temp`=0x7B
- Iteration 3 (0x23): `crc`=0x9E, `temp`=0x58
- Finalize: `crc` = 0x9E + 0x58 = 0xF6
- Result: `[0x58, 0xF6]` (High: XOR result, Low: Adjusted Sum)
