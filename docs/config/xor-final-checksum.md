# Parameterized XOR final checksum

`xor_final(0xNN)` calculates a one-byte checksum by XORing every byte in the checksum range and then XORing the result with the configured final value.

```yaml
homenet_bridge:
  packet_defaults:
    rx_checksum: xor_final(0x55)
    tx_checksum: xor_final(0x55)
```

For `rx_checksum`, the default range includes the packet header, matching the existing `xor` checksum behavior. The checksum byte itself is not included in the calculated range.

Examples:

- `xor_final(0x55)` → `XOR(frame bytes) ^ 0x55`
- `xor_final(0x00)` → equivalent to plain `xor`
- `xor_final(0xff)` → `XOR(frame bytes) ^ 0xff`

The final XOR value must be written as exactly two hexadecimal digits (`0x00` through `0xff`).
