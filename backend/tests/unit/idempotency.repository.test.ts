import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { createIdempotencyRepository } from '../../src/repositories/idempotency.repository';
import {
  commandAt,
  conditionalCheckFailed,
  createFakeDocumentClient,
} from './helpers/fake-document-client';

const TABLE = 'cartflow-test';
const FIXED_NOW_SECONDS = 1_800_000_000;
const SAMPLE_RESPONSE_JSON =
  '{"statusCode":201,"headers":{"content-type":"application/json"},"body":"{\\"ok\\":true}"}';

function setup() {
  const { client, send } = createFakeDocumentClient();
  const repository = createIdempotencyRepository({
    client,
    tableName: TABLE,
    nowSeconds: () => FIXED_NOW_SECONDS,
  });
  return { repository, send };
}

describe('getRecord', () => {
  it('returns null when no record exists', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    const record = await repository.getRecord('cart-add-item#user-1#key-1');

    expect(record).toBeNull();
    expect(commandAt(send, 0)).toBeInstanceOf(GetCommand);
  });

  it('returns the cached response when a fresh record exists', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({
      Item: {
        PK: 'IDEMPOTENCY#cart-add-item#user-1#key-1',
        SK: 'RECORD',
        responseJson: SAMPLE_RESPONSE_JSON,
        ttl: FIXED_NOW_SECONDS + 3600,
      },
    });

    const record = await repository.getRecord('cart-add-item#user-1#key-1');

    expect(record).toEqual({ responseJson: SAMPLE_RESPONSE_JSON });
  });

  it('treats an expired-but-not-yet-swept record as absent', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({
      Item: {
        PK: 'IDEMPOTENCY#cart-add-item#user-1#key-1',
        SK: 'RECORD',
        responseJson: SAMPLE_RESPONSE_JSON,
        ttl: FIXED_NOW_SECONDS - 1, // in the past
      },
    });

    const record = await repository.getRecord('cart-add-item#user-1#key-1');

    expect(record).toBeNull();
  });
});

describe('saveRecord', () => {
  it('writes a conditional PutItem with the computed ttl', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    await repository.saveRecord(
      'cart-add-item#user-1#key-1',
      { responseJson: SAMPLE_RESPONSE_JSON },
      3600,
    );

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      TableName: TABLE,
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: {
        PK: 'IDEMPOTENCY#cart-add-item#user-1#key-1',
        SK: 'RECORD',
        responseJson: SAMPLE_RESPONSE_JSON,
        ttl: FIXED_NOW_SECONDS + 3600,
      },
    });
  });

  it('silently drops the write when a racing duplicate already saved one', async () => {
    const { repository, send } = setup();
    send.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(
      repository.saveRecord('cart-add-item#user-1#key-1', { responseJson: '{}' }, 3600),
    ).resolves.toBeUndefined();
  });

  it('propagates an unexpected error', async () => {
    const { repository, send } = setup();
    send.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));

    await expect(
      repository.saveRecord('cart-add-item#user-1#key-1', { responseJson: '{}' }, 3600),
    ).rejects.toThrow('DynamoDB is unreachable');
  });
});
