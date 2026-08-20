import { PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { ConflictError, NotFoundError, ValidationError } from '../../src/errors/app-error';
import { cartKeys, createCartRepository } from '../../src/repositories/cart.repository';
import {
  FIXED_NOW,
  commandAt,
  conditionalCheckFailed,
  createFakeDocumentClient,
  fixedClock,
  transactionCanceled,
} from './helpers/fake-document-client';

const TABLE = 'cartflow-test';

function setup() {
  const { client, send } = createFakeDocumentClient();
  const repository = createCartRepository({ client, tableName: TABLE, now: fixedClock });
  return { repository, send };
}

const header = {
  PK: 'USER#u-1',
  SK: 'CART',
  entityType: 'CART',
  userId: 'u-1',
  currency: 'USD',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

function line(productId: string, quantity: number) {
  return {
    PK: 'USER#u-1',
    SK: `CART#ITEM#${productId}`,
    entityType: 'CART_ITEM',
    userId: 'u-1',
    productId,
    quantity,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('cartKeys', () => {
  it('builds the documented key layout', () => {
    expect(cartKeys.pk('u-1')).toBe('USER#u-1');
    expect(cartKeys.headerSk()).toBe('CART');
    expect(cartKeys.itemSk('p-1')).toBe('CART#ITEM#p-1');
    expect(cartKeys.itemSk('p-1').startsWith(cartKeys.skPrefix())).toBe(true);
  });
});

describe('getCart', () => {
  it('reads header and lines with a single partition query', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [header, line('p-1', 2)] });

    const cart = await repository.getCart('u-1');

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: { ':pk': 'USER#u-1', ':skPrefix': 'CART' },
      ScanIndexForward: true,
    });
    expect(cart).toEqual({
      userId: 'u-1',
      currency: 'USD',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      items: [
        {
          userId: 'u-1',
          productId: 'p-1',
          quantity: 2,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('follows LastEvaluatedKey so a large cart is never truncated', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({
      Items: [header],
      LastEvaluatedKey: { PK: 'USER#u-1', SK: 'CART' },
    });
    send.mockResolvedValueOnce({ Items: [line('p-1', 1), line('p-2', 3)] });

    const cart = await repository.getCart('u-1');

    expect(send).toHaveBeenCalledTimes(2);
    expect(commandAt(send, 1).input).toMatchObject({
      ExclusiveStartKey: { PK: 'USER#u-1', SK: 'CART' },
    });
    expect(cart?.items).toHaveLength(2);
  });

  it('returns null when no cart header exists', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [] });

    await expect(repository.getCart('u-1')).resolves.toBeNull();
  });
});

describe('createCart', () => {
  it('puts the header guarded against clobbering an existing cart', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    const cart = await repository.createCart({ userId: 'u-1' });

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      Item: {
        PK: 'USER#u-1',
        SK: 'CART',
        entityType: 'CART',
        userId: 'u-1',
        currency: 'USD',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    });
    expect(cart.items).toEqual([]);
  });

  it('reports an existing cart as a conflict', async () => {
    const { repository, send } = setup();
    send.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(repository.createCart({ userId: 'u-1' })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('updateCart', () => {
  it('writes the whole cart in one transaction locked on the header updatedAt', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [header, line('p-1', 2), line('p-2', 1)] });
    send.mockResolvedValueOnce({});

    const cart = await repository.updateCart({
      userId: 'u-1',
      items: [
        { productId: 'p-1', quantity: 5 },
        { productId: 'p-3', quantity: 1 },
      ],
    });

    const command = commandAt(send, 1);
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input).toEqual({
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { PK: 'USER#u-1', SK: 'CART' },
            UpdateExpression: 'SET #updatedAt = :updatedAt',
            ConditionExpression: 'attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt',
            ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: {
              ':updatedAt': FIXED_NOW,
              ':expectedUpdatedAt': '2026-08-02T00:00:00.000Z',
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: 'USER#u-1',
              SK: 'CART#ITEM#p-1',
              entityType: 'CART_ITEM',
              userId: 'u-1',
              productId: 'p-1',
              quantity: 5,
              // createdAt is preserved from the existing line.
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: FIXED_NOW,
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: 'USER#u-1',
              SK: 'CART#ITEM#p-3',
              entityType: 'CART_ITEM',
              userId: 'u-1',
              productId: 'p-3',
              quantity: 1,
              createdAt: FIXED_NOW,
              updatedAt: FIXED_NOW,
            },
          },
        },
        {
          // p-2 was omitted from the replacement payload, so it is dropped.
          Delete: {
            TableName: TABLE,
            Key: { PK: 'USER#u-1', SK: 'CART#ITEM#p-2' },
          },
        },
      ],
    });
    expect(cart.items.map((item) => item.productId)).toEqual(['p-1', 'p-3']);
    expect(cart.updatedAt).toBe(FIXED_NOW);
  });

  it('deletes a line whose quantity drops to zero', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [header, line('p-1', 2)] });
    send.mockResolvedValueOnce({});

    const cart = await repository.updateCart({
      userId: 'u-1',
      items: [{ productId: 'p-1', quantity: 0 }],
    });

    expect(commandAt(send, 1).input).toMatchObject({
      TransactItems: [
        expect.objectContaining({ Update: expect.anything() }),
        { Delete: { TableName: TABLE, Key: { PK: 'USER#u-1', SK: 'CART#ITEM#p-1' } } },
      ],
    });
    expect(cart.items).toEqual([]);
  });

  it('does not emit a delete for a zero-quantity line that was never in the cart', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [header] });
    send.mockResolvedValueOnce({});

    await repository.updateCart({ userId: 'u-1', items: [{ productId: 'p-9', quantity: 0 }] });

    const transactItems = (commandAt(send, 1).input as { TransactItems: unknown[] }).TransactItems;
    expect(transactItems).toHaveLength(1);
  });

  it('fails when the cart has not been created', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [] });

    await expect(repository.updateCart({ userId: 'u-1', items: [] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects duplicate, negative and key-breaking lines before any write', async () => {
    const { repository, send } = setup();
    send.mockResolvedValue({ Items: [header] });

    await expect(
      repository.updateCart({
        userId: 'u-1',
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-1', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      repository.updateCart({ userId: 'u-1', items: [{ productId: 'p-1', quantity: -1 }] }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      repository.updateCart({ userId: 'u-1', items: [{ productId: 'p#1', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(send).not.toHaveBeenCalledWith(expect.any(TransactWriteCommand));
  });

  it('rejects a cart that would exceed the DynamoDB transaction limit', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [header] });

    const items = Array.from({ length: 100 }, (_, index) => ({
      productId: `p-${index}`,
      quantity: 1,
    }));

    await expect(repository.updateCart({ userId: 'u-1', items })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('turns a cancelled transaction into a conflict', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [header] });
    send.mockRejectedValueOnce(transactionCanceled(['ConditionalCheckFailed']));

    await expect(
      repository.updateCart({ userId: 'u-1', items: [{ productId: 'p-1', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rethrows a cancellation that was not caused by a condition', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [header] });
    send.mockRejectedValueOnce(transactionCanceled(['ThrottlingError']));

    await expect(
      repository.updateCart({ userId: 'u-1', items: [{ productId: 'p-1', quantity: 1 }] }),
    ).rejects.not.toBeInstanceOf(ConflictError);
  });
});
