#!/usr/bin/env node
/**
 * JSON Schema 생성 스크립트
 *
 * TypeScript 타입 정의로부터 JSON Schema를 생성하여
 * Monaco YAML 에디터에서 자동완성 및 유효성 검사에 사용합니다.
 */

import * as TJS from 'typescript-json-schema';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const settings: TJS.PartialArgs = {
  required: true,
  noExtraProps: false,
  ignoreErrors: true,
  // ref: true로 설정하여 재귀적 타입에 대한 definitions 생성
  ref: true,
};

const compilerOptions: TJS.CompilerOptions = {
  strictNullChecks: true,
  esModuleInterop: true,
  moduleResolution: 2, // NodeNext
  target: 99, // ESNext
};

// 소스 파일 경로
const typesFile = path.resolve(__dirname, '../src/config/types.ts');

// 출력 디렉토리 (dist 대신 static 사용 - Docker 빌드 시 권한 문제 방지)
const outputDir = path.resolve(__dirname, '../static/schema');
const outputFile = path.join(outputDir, 'homenet-bridge.schema.json');

async function main() {
  console.log('🔧 JSON Schema 생성 중...');
  console.log(`   소스: ${typesFile}`);

  // 프로그램 생성
  const program = TJS.getProgramFromFiles([typesFile], compilerOptions);

  // HomenetBridgeConfig 스키마 생성
  const schema = TJS.generateSchema(program, 'HomenetBridgeConfig', settings);

  if (!schema) {
    console.error('❌ 스키마 생성 실패: HomenetBridgeConfig 타입을 찾을 수 없습니다.');
    process.exit(1);
  }

  // definitions 분리
  const definitions = schema.definitions;
  delete schema.definitions;

  // 루트 스키마로 감싸기 (homenet_bridge 키 아래에 배치)
  // definitions는 재귀적 타입 참조를 위해 루트에 포함
  const rootSchema: Record<string, unknown> = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'HomeNet Bridge Configuration',
    description: 'RS485 HomeNet to MQTT Bridge 설정 파일 스키마',
    type: 'object',
    properties: {
      homenet_bridge: schema,
    },
    required: ['homenet_bridge'],
    additionalProperties: false,
  };

  // 재귀적 타입(AutomationAction 등)의 $ref를 resolve하기 위해 definitions를 루트에 복사
  if (definitions && Object.keys(definitions).length > 0) {
    rootSchema.definitions = definitions;
  }

  // 출력 디렉토리 생성
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 스키마 저장
  fs.writeFileSync(outputFile, JSON.stringify(rootSchema, null, 2), 'utf-8');

  console.log(`✅ 스키마 생성 완료: ${outputFile}`);

  // 통계 출력
  const stats = {
    properties: Object.keys(schema.properties || {}).length,
    definitions: Object.keys(definitions || {}).length,
  };
  console.log(`   속성: ${stats.properties}개, 정의: ${stats.definitions}개`);
}

main().catch((err) => {
  console.error('❌ 스키마 생성 오류:', err);
  process.exit(1);
});
