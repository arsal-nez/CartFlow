import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';

/**
 * Structural regression tests against `serverless.yml` itself — not the
 * application code. These exist because the IAM least-privilege split
 * (`PublicReadExecutionRole` / `CustomerCartExecutionRole` /
 * `AdminWriteExecutionRole` — see docs/database.md, "IAM: Per-Function
 * Least Privilege") only works if every function actually opts into one of
 * them; a new function added later without a `role:` line would silently
 * fall back to a shared default role and quietly undo the whole point.
 * Parsing the real YAML (not a copy) means these tests fail the moment that
 * happens, without needing an AWS deploy to notice.
 */

interface ServerlessFunction {
  handler: string;
  role?: string;
}

interface ServerlessConfig {
  provider: {
    httpApi?: { cors?: { allowCredentials?: boolean } };
  };
  functions: Record<string, ServerlessFunction>;
  resources: { Resources: Record<string, { Type: string }> };
}

function loadConfig(): ServerlessConfig {
  const raw = readFileSync(join(__dirname, '../../../serverless.yml'), 'utf8');
  return load(raw) as ServerlessConfig;
}

const KNOWN_ROLES = [
  'PublicReadExecutionRole',
  'CustomerCartExecutionRole',
  'AdminWriteExecutionRole',
];

// `health` is the sole documented exception: it touches no AWS resource, so
// the bare default (logs-only) role IS its least-privilege role.
const FUNCTIONS_ALLOWED_NO_EXPLICIT_ROLE = ['health'];

describe('serverless.yml IAM wiring', () => {
  it('defines exactly the three least-privilege roles this audit introduced', () => {
    const config = loadConfig();
    for (const role of KNOWN_ROLES) {
      expect(config.resources.Resources[role]?.Type).toBe('AWS::IAM::Role');
    }
  });

  it('gives every function except the documented exception an explicit, known role', () => {
    const config = loadConfig();
    const offenders: string[] = [];

    for (const [name, fn] of Object.entries(config.functions)) {
      if (FUNCTIONS_ALLOWED_NO_EXPLICIT_ROLE.includes(name)) {
        continue;
      }
      if (fn.role === undefined || !KNOWN_ROLES.includes(fn.role)) {
        offenders.push(name);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never grants the public-read role write access — no PutItem/UpdateItem/DeleteItem/TransactWriteItems', () => {
    const raw = readFileSync(join(__dirname, '../../../serverless.yml'), 'utf8');
    const config = load(raw) as {
      resources: {
        Resources: {
          PublicReadExecutionRole: {
            Properties: {
              Policies: Array<{ PolicyDocument: { Statement: Array<{ Action: string[] }> } }>;
            };
          };
        };
      };
    };
    const actions = config.resources.Resources.PublicReadExecutionRole.Properties.Policies.flatMap(
      (policy) => policy.PolicyDocument.Statement.flatMap((statement) => statement.Action),
    );

    for (const writeAction of [
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:TransactWriteItems',
    ]) {
      expect(actions).not.toContain(writeAction);
    }
  });

  it('never grants the customer-cart role S3 or DeleteItem access', () => {
    const raw = readFileSync(join(__dirname, '../../../serverless.yml'), 'utf8');
    const config = load(raw) as {
      resources: {
        Resources: {
          CustomerCartExecutionRole: {
            Properties: {
              Policies: Array<{ PolicyDocument: { Statement: Array<{ Action: string[] }> } }>;
            };
          };
        };
      };
    };
    const actions =
      config.resources.Resources.CustomerCartExecutionRole.Properties.Policies.flatMap((policy) =>
        policy.PolicyDocument.Statement.flatMap((statement) => statement.Action),
      );

    expect(actions.some((action) => action.startsWith('s3:'))).toBe(false);
    expect(actions).not.toContain('dynamodb:DeleteItem');
  });

  it('keeps CORS credential-less (Bearer-token auth, not cookies)', () => {
    const config = loadConfig();
    expect(config.provider.httpApi?.cors?.allowCredentials).toBe(false);
  });
});
