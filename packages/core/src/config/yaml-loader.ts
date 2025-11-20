import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import { LambdaConfig } from '../protocol/types.js';

const LambdaType = new yaml.Type('!lambda', {
    kind: 'scalar',
    construct: (data: string): LambdaConfig => {
        return { type: 'lambda', script: data };
    },
});

const SCHEMA = yaml.DEFAULT_SCHEMA.extend([LambdaType]);

export async function loadYamlConfig(filePath: string): Promise<any> {
    const fileContent = await fs.readFile(filePath, 'utf8');
    return yaml.load(fileContent, { schema: SCHEMA });
}
