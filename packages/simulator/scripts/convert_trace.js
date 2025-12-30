import fs from 'fs';
import path from 'path';

// Get input file from command line argument or default to the specific file mentioned by user
const args = process.argv.slice(2);
const defaultInputPath = path.resolve(
    process.cwd(),
    '../../.logs/samsung-sds-usb-serial copy.json',
);
let inputPath = args[0] || defaultInputPath;

// Handle relative paths if argument provided
if (!path.isAbsolute(inputPath) && args[0]) {
    inputPath = path.resolve(process.cwd(), inputPath);
}

if (!fs.existsSync(inputPath)) {
    // Try resolving relative from root if not found
    const rootPath = path.resolve('../../../', inputPath);
    if (fs.existsSync(rootPath)) {
        inputPath = rootPath;
    } else {
        console.error(`File not found: ${inputPath}`);
        console.error(`Usage: node convert_trace.js [path-to-input-json]`);
        process.exit(1);
    }
}

try {
    const content = fs.readFileSync(inputPath, 'utf8');
    const json = JSON.parse(content);

    if (!json.packets || !Array.isArray(json.packets)) {
        console.error('Invalid JSON format: missing "packets" array');
        process.exit(1);
    }

    const packets = json.packets;
    const convertedPackets = packets.map((packetHex) => {
        const bytes = [];
        // Handle potential case issues or spaces if any, though user sample was clean hex
        const cleanHex = packetHex.trim();
        for (let i = 0; i < cleanHex.length; i += 2) {
            bytes.push('0x' + cleanHex.substring(i, i + 2));
        }
        return `  [${bytes.join(', ')}]`;
    });

    /*
    const fileContent = `export const PACKETS_FROM_USERDATA: readonly number[][] = [
  ${convertedPackets.join(',\n')}
  ];
  `;
    */

    // Determine output path relative to this script
    // __dirname is not available in ES modules, use path to resolve relative to process.cwd() or import.meta if needed
    // Since we are running as "node packages/simulator/scripts/convert_trace.js", current cwd is root probably
    // Let's rely on fixed path as requested or resolve relative to package root.

    const outputPath = path.resolve(process.cwd(), 'packages/simulator/src/packets_from_userdata.ts');

    const fileContent = `export const PACKETS_FROM_USERDATA: readonly number[][] = [
${convertedPackets.join(',\n')}
];
`;

    fs.writeFileSync(outputPath, fileContent, 'utf8');
    console.log(`Successfully converted ${packets.length} packets to ${outputPath}`);
} catch (err) {
    console.error('Error processing file:', err);
    process.exit(1);
}
