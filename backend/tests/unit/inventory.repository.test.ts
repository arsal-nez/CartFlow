import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { deriveStockStatus } from '../../src/domain/inventory';
import { ConflictError, ValidationError } from '../../src/errors/app-error';
import {
  createInventoryRepository,
  inventoryKeys,
} from '../../src/repositories/inventory.repository';
import {
  FIXED_NOW,
  commandAt,
  conditionalCheckFailed,
  createFakeDocumentClient,
  fixedClock,
} from './helpers/fake-document-client';

const TABLE = 'cartflow-test';

function setup() {
  const { client, send } = createFakeDocumentClient();
  const repository = createInventoryRepository({ client, tableName: TABLE, now: fixedClock });
  return { repository, send };
}

const storedInventory = {
  PK: 'PRODUCT#p-1',
  SK: 'INVENTORY',
  GSI3PK: 'INVENTORY#STATUS#IN_STOCK',
  GSI3SK: 'AVAILABLE#000000000010#PRODUCT#p-1',
  entityType: 'INVENTORY',
  productId: 'p-1',
  availableQuantity: 10,
  reservedQuantity: 2,
  reorderThreshold: 3,
  stockStatus: 'IN_STOCK',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

describe('inventoryKeys and stock status', () => {
  it('builds the documented key layout', () => {
    expect(inventoryKeys.pk('p-1')).toBe('PRODUCT#p-1');
    expect(inventoryKeys.sk()).toBe('INVENTORY');
    expect(inventoryKeys.gsi3pk('LOW')).toBe('INVENTORY#STATUS#LOW');
    expect(inventoryKeys.gsi3sk(10, 'p-1')).toBe('AVAILABLE#000000000010#PRODUCT#p-1');
  });

  it('derives stock status from the reorder threshold', () => {
    expect(deriveStockStatus(0, 3)).toBe('OUT_OF_STOCK');
    expect(deriveStockStatus(3, 3)).toBe('LOW');
    expect(deriveStockStatus(4, 3)).toBe('IN_STOCK');
  });
});

describe('getInventory', () => {
  it('gets the inventory item from the product partition', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });

    const inventory = await repository.getInventory('p-1');

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(GetCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      Key: { PK: 'PRODUCT#p-1', SK: 'INVENTORY' },
      ConsistentRead: false,
    });
    expect(inventory).toEqual({
      productId: 'p-1',
      availableQuantity: 10,
      reservedQuantity: 2,
      reorderThreshold: 3,
      stockStatus: 'IN_STOCK',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('supports a strongly consistent read for stock decisions', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });

    await repository.getInventory('p-1', { consistentRead: true });

    expect(commandAt(send, 0).input).toMatchObject({ ConsistentRead: true });
  });

  it('returns null when the product has no inventory record', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    await expect(repository.getInventory('p-1')).resolves.toBeNull();
  });
});

describe('updateInventory', () => {
  it('applies a delta with a conditional write on the counters it read', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });
    send.mockResolvedValueOnce({
      Attributes: { ...storedInventory, availableQuantity: 8, updatedAt: FIXED_NOW },
    });

    await repository.updateInventory('p-1', { availableQuantityDelta: -2 });

    expect(commandAt(send, 0).input).toMatchObject({ ConsistentRead: true });
    const command = commandAt(send, 1);
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      Key: { PK: 'PRODUCT#p-1', SK: 'INVENTORY' },
      UpdateExpression:
        'SET #availableQuantity = :availableQuantity, #reservedQuantity = :reservedQuantity, ' +
        '#reorderThreshold = :reorderThreshold, #stockStatus = :stockStatus, ' +
        '#updatedAt = :updatedAt, #gsi3pk = :gsi3pk, #gsi3sk = :gsi3sk',
      ConditionExpression:
        'attribute_exists(PK) AND #availableQuantity = :expectedAvailableQuantity ' +
        'AND #reservedQuantity = :expectedReservedQuantity',
      ExpressionAttributeNames: {
        '#availableQuantity': 'availableQuantity',
        '#reservedQuantity': 'reservedQuantity',
        '#reorderThreshold': 'reorderThreshold',
        '#stockStatus': 'stockStatus',
        '#updatedAt': 'updatedAt',
        '#gsi3pk': 'GSI3PK',
        '#gsi3sk': 'GSI3SK',
      },
      ExpressionAttributeValues: {
        ':availableQuantity': 8,
        ':reservedQuantity': 2,
        ':reorderThreshold': 3,
        ':stockStatus': 'IN_STOCK',
        ':updatedAt': FIXED_NOW,
        ':gsi3pk': 'INVENTORY#STATUS#IN_STOCK',
        ':gsi3sk': 'AVAILABLE#000000000008#PRODUCT#p-1',
        ':expectedAvailableQuantity': 10,
        ':expectedReservedQuantity': 2,
      },
      ReturnValues: 'ALL_NEW',
    });
  });

  it('recomputes the denormalized stock status when stock crosses the threshold', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });
    send.mockResolvedValueOnce({ Attributes: { ...storedInventory, availableQuantity: 2 } });

    await repository.updateInventory('p-1', { availableQuantity: 2 });

    expect(commandAt(send, 1).input).toMatchObject({
      ExpressionAttributeValues: {
        ':stockStatus': 'LOW',
        ':gsi3pk': 'INVENTORY#STATUS#LOW',
        ':gsi3sk': 'AVAILABLE#000000000002#PRODUCT#p-1',
      },
    });
  });

  it('refuses to drive available stock negative', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });

    await expect(
      repository.updateInventory('p-1', { availableQuantityDelta: -11 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses an absolute value and a delta for the same counter', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });

    await expect(
      repository.updateInventory('p-1', { availableQuantity: 5, availableQuantityDelta: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fails fast when the caller holds a stale updatedAt', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });

    await expect(
      repository.updateInventory('p-1', {
        availableQuantityDelta: -1,
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('turns a lost stock race into a conflict', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedInventory });
    send.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(
      repository.updateInventory('p-1', { availableQuantityDelta: -1 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('initialises a missing record from absolute quantities', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});
    send.mockResolvedValueOnce({});

    const inventory = await repository.updateInventory('p-1', {
      availableQuantity: 0,
      reorderThreshold: 5,
    });

    const command = commandAt(send, 1);
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      Item: {
        PK: 'PRODUCT#p-1',
        SK: 'INVENTORY',
        GSI3PK: 'INVENTORY#STATUS#OUT_OF_STOCK',
        GSI3SK: 'AVAILABLE#000000000000#PRODUCT#p-1',
        entityType: 'INVENTORY',
        productId: 'p-1',
        availableQuantity: 0,
        reservedQuantity: 0,
        reorderThreshold: 5,
        stockStatus: 'OUT_OF_STOCK',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    });
    expect(inventory.stockStatus).toBe('OUT_OF_STOCK');
  });

  it('refuses to apply a delta to a record that does not exist', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    await expect(
      repository.updateInventory('p-1', { availableQuantityDelta: 5 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
