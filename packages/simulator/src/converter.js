import fs from 'fs';
import path from 'path';

// 명령줄 인수 확인
if (process.argv.length < 4) {
    console.error('사용법: node converter.js <입력_로그_파일> <출력_JS_파일>');
    console.error('예시: node converter.js input.log result.ts');
    process.exit(1);
}

// 경로 가져오기
const inputPath = process.argv[2];
const outputPath = process.argv[3];

try {
    // 파일 읽기
    const fileContent = fs.readFileSync(inputPath, 'utf8');
    const lines = fileContent.split('\n');

    // 결과 문자열 버퍼 시작 부분
    let result = 'export const SAMSUNG_SDS_PACKETS: readonly (Buffer | number[])[] = [\n';

    // 라인별 처리
    lines.forEach((line) => {
        // 빈 줄 무시
        if (!line.trim()) return;

        // 정규식으로 날짜와 데이터 분리
        // 형식: 2024-02-05 09:35:04 INFO <HEX DATA>
        const match = line.match(/^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\s+INFO\s+(.*)$/);

        if (match) {
            const timestamp = match[1];
            const rawHexData = match[2].trim();

            // 헥사 데이터가 비어있지 않은 경우만 처리
            if (rawHexData) {
                // 공백으로 분리하여 0x 접두사 붙이기
                const hexArray = rawHexData
                    .split(/\s+/) // 공백(스페이스 여러 개 포함)으로 분리
                    .map(hex => `0x${hex}`); // 0x 접두사 추가

                // 결과 문자열에 추가
                result += `    // ${timestamp}\n`;
                result += `    [${hexArray.join(', ')}],\n`;
            }
        }
    });

    // 결과 문자열 종료 부분
    result += '];\n';

    // 파일 쓰기
    fs.writeFileSync(outputPath, result, 'utf8');

    console.log(`변환 완료! 결과가 저장되었습니다: ${outputPath}`);

} catch (err) {
    console.error('오류 발생:', err.message);
    process.exit(1);
}