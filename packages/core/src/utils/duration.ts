// packages/core/src/utils/duration.ts

/**
 * Parse duration string to milliseconds
 * Supports: ms, s, m, h
 * Examples: "10ms" -> 10, "1s" -> 1000, "5m" -> 300000
 */
export function parseDuration(value: string | number | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value === 'number') {
        return value;
    }

    const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
    if (!match) {
        throw new Error(`Invalid duration format: ${value}`);
    }

    const num = parseFloat(match[1]);
    const unit = match[2] || 'ms'; // default to ms if no unit

    switch (unit) {
        case 'ms':
            return num;
        case 's':
            return num * 1000;
        case 'm':
            return num * 60 * 1000;
        case 'h':
            return num * 60 * 60 * 1000;
        default:
            throw new Error(`Unknown duration unit: ${unit}`);
    }
}
