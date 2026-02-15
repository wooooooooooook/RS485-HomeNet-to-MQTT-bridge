
import { describe, it, expect } from 'vitest';
import { calculateChecksum2, verifyChecksum2FromBuffer } from '../src/protocol/utils/checksum';

describe('CRC-CCITT XModem Checksum', () => {
    it('should calculate correct checksum for example packet', () => {
        // Example from user:
        // Packet: 0xAA 0x55 0x7A 0x9E 0x02 0x02 0x00 0xFF 0xFF 0xFF 0xFF 0x31 0xFF 0xFF 0xFF 0x01 0x01 0x29 0xF6 0x0D 0x0D
        // Header: AA 55
        // Data for CRC: 7A 9E 02 02 00 FF FF FF FF 31 FF FF FF 01 01
        // Checksum: 0x29 0xF6

        const header = [0xAA, 0x55];
        const data = [0x7A, 0x9E, 0x02, 0x02, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x31, 0xFF, 0xFF, 0xFF, 0x01, 0x01];
        const expectedChecksum = [0x29, 0xF6];

        const result = calculateChecksum2(header, data, 'crc_ccitt_xmodem');
        expect(result).toEqual(expectedChecksum);
    });

    it('should verify checksum from buffer correctly', () => {
        const packet = [
            0xAA, 0x55, // Header (ignored by this CRC logic as per user requirement to check packet[2:17])
            0x7A, 0x9E, 0x02, 0x02, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x31, 0xFF, 0xFF, 0xFF, 0x01, 0x01, // Data
            0x29, 0xF6, // Checksum
            0x0D, 0x0D  // Footer
        ];
        
        // Header length is 2.
        // Data ends at index 17 (exclusive) => length 15.
        // Start index for CRC calculation should be 2 (after header).
        // verifyChecksum2FromBuffer uses `headerStart` for `crc_ccitt_xmodem` which is `baseOffset + _headerLength`
        
        const buffer = Buffer.from(packet);
        const headerLength = 2;
        const dataEnd = 17; // Index where data ends (exclusive)

        const isValid = verifyChecksum2FromBuffer(
            buffer,
            'crc_ccitt_xmodem',
            headerLength,
            dataEnd,
            0,
            0x29, 
            0xF6
        );

        expect(isValid).toBe(true);
    });

    it('should verify OFF packet checksum', () => {
        // OFF: 0xAA 0x55 0x7A 0x9E 0x02 0x02 0x00 0xFF 0xFF 0xFF 0xFF 0x31 0xFF 0xFF 0xFF 0x02 0x00 0x6C 0x84 0x0D 0x0D
        const packet = [
            0xAA, 0x55,
            0x7A, 0x9E, 0x02, 0x02, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x31, 0xFF, 0xFF, 0xFF, 0x02, 0x00, // Data
            0x6C, 0x84, // Checksum
            0x0D, 0x0D
        ];

        const buffer = Buffer.from(packet);
        const headerLength = 2;
        const dataEnd = 17;

        const isValid = verifyChecksum2FromBuffer(
            buffer,
            'crc_ccitt_xmodem',
            headerLength,
            dataEnd,
            0,
            0x6C,
            0x84
        );

        expect(isValid).toBe(true);
    });
    
     it('should fail on invalid checksum', () => {
        const packet = [
            0xAA, 0x55,
            0x7A, 0x9E, 0x02, 0x02, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x31, 0xFF, 0xFF, 0xFF, 0x01, 0x01,
            0x00, 0x00, // INVALID Checksum
            0x0D, 0x0D
        ];

        const buffer = Buffer.from(packet);
         const headerLength = 2;
        const dataEnd = 17;

        const isValid = verifyChecksum2FromBuffer(
            buffer,
            'crc_ccitt_xmodem',
            headerLength,
            dataEnd,
            0,
            packet[17],
            packet[18]
        );

        expect(isValid).toBe(false);
    });
});
