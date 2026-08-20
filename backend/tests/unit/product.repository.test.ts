import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { ConflictError, NotFoundError, ValidationError } from '../../src/errors/app-error';
import { encodeCursor } from '../../src/lib/dynamodb';
import { createProductRepository, productKeys } from '../../src/repositories/product.repository';
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
  const repository = createProductRepository({ client, tableName: TABLE, now: fixedClock });
  return { repository, send };
}

const storedProduct = {
  PK: 'PRODUCT#p-1',
  SK: 'META',
  GSI1PK: 'PRODUCTS#STATUS#ACTIVE',
  GSI1SK: 'CATEGORY#c-1#NAME#blue-mug#PRODUCT#p-1',
  entityType: 'PRODUCT',
  productId: 'p-1',
  name: 'Blue Mug',
  normalizedName: 'blue-mug',
  description: 'A mug',
  categoryId: 'c-1',
  status: 'ACTIVE',
  priceCents: 1200,
  currency: 'USD',
  imageKeys: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

describe('productKeys', () => {
  it('builds the documented key layout', () => {
    expect(productKeys.pk('p-1')).toBe('PRODUCT#p-1');
    expect(productKeys.sk()).toBe('META');
    expect(productKeys.gsi1pk('ACTIVE')).toBe('PRODUCTS#STATUS#ACTIVE');
    expect(productKeys.gsi1sk('c-1', 'blue-mug', 'p-1')).toBe(
      'CATEGORY#c-1#NAME#blue-mug#PRODUCT#p-1',
    );
    expect(productKeys.gsi1skCategoryPrefix('c-1')).toBe('CATEGORY#c-1#');
  });
});

describe('create', () => {
  it('puts a fully keyed item guarded against overwriting an existing product', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    const product = await repository.create({
      productId: 'p-1',
      name: 'Blue Mug',
      description: 'A mug',
      categoryId: 'c-1',
      priceCents: 1200,
      currency: 'USD',
      status: 'ACTIVE',
    });

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      Item: {
        PK: 'PRODUCT#p-1',
        SK: 'META',
        GSI1PK: 'PRODUCTS#STATUS#ACTIVE',
        GSI1SK: 'CATEGORY#c-1#NAME#blue-mug#PRODUCT#p-1',
        entityType: 'PRODUCT',
        productId: 'p-1',
        name: 'Blue Mug',
        normalizedName: 'blue-mug',
        description: 'A mug',
        categoryId: 'c-1',
        status: 'ACTIVE',
        priceCents: 1200,
        currency: 'USD',
        imageKeys: [],
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    });
    expect(product).not.toHaveProperty('PK');
    expect(product.normalizedName).toBe('blue-mug');
  });

  it('defaults new products to DRAFT so they stay out of the active listing', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    await repository.create({
      productId: 'p-2',
      name: 'Draft Item',
      description: '',
      categoryId: 'c-1',
      priceCents: 100,
      currency: 'USD',
    });

    expect(commandAt(send, 0).input).toMatchObject({
      Item: { status: 'DRAFT', GSI1PK: 'PRODUCTS#STATUS#DRAFT' },
    });
  });

  it('translates a failed condition into a conflict', async () => {
    const { repository, send } = setup();
    send.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(
      repository.create({
        productId: 'p-1',
        name: 'Blue Mug',
        description: '',
        categoryId: 'c-1',
        priceCents: 1,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects identifiers that would corrupt the key layout', async () => {
    const { repository, send } = setup();

    await expect(
      repository.create({
        productId: 'p-1',
        name: 'Mug',
        description: '',
        categoryId: 'c#1',
        priceCents: 1,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a name with no sortable characters', async () => {
    const { repository } = setup();

    await expect(
      repository.create({
        productId: 'p-1',
        name: '###',
        description: '',
        categoryId: 'c-1',
        priceCents: 1,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('getById', () => {
  it('gets the metadata item by primary key', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedProduct });

    const product = await repository.getById('p-1');

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(GetCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      Key: { PK: 'PRODUCT#p-1', SK: 'META' },
    });
    expect(product).toEqual({
      productId: 'p-1',
      name: 'Blue Mug',
      normalizedName: 'blue-mug',
      description: 'A mug',
      categoryId: 'c-1',
      status: 'ACTIVE',
      priceCents: 1200,
      currency: 'USD',
      imageKeys: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('returns null for a missing product', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    await expect(repository.getById('missing')).resolves.toBeNull();
  });
});

describe('list', () => {
  it('queries GSI1 for the active status partition without a filter or scan', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [storedProduct] });

    const page = await repository.list();

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :gsi1pk',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
      ExpressionAttributeValues: { ':gsi1pk': 'PRODUCTS#STATUS#ACTIVE' },
      Limit: 20,
      ScanIndexForward: true,
    });
    expect(page.items).toHaveLength(1);
    expect(page.cursor).toBeNull();
  });

  it('honours the requested status and clamps the limit to the server maximum', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [] });

    await repository.list({ status: 'ARCHIVED', limit: 5000 });

    expect(commandAt(send, 0).input).toMatchObject({
      ExpressionAttributeValues: { ':gsi1pk': 'PRODUCTS#STATUS#ARCHIVED' },
      Limit: 100,
    });
  });

  it('rejects a non-positive limit', async () => {
    const { repository } = setup();
    await expect(repository.list({ limit: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('feeds a cursor back as the ExclusiveStartKey and returns the next cursor', async () => {
    const { repository, send } = setup();
    const lastKey = { PK: 'PRODUCT#p-1', SK: 'META' };
    send.mockResolvedValueOnce({ Items: [storedProduct], LastEvaluatedKey: lastKey });

    const cursor = encodeCursor({ PK: 'PRODUCT#p-0', SK: 'META' });
    const page = await repository.list({ cursor });

    expect(commandAt(send, 0).input).toMatchObject({
      ExclusiveStartKey: { PK: 'PRODUCT#p-0', SK: 'META' },
    });
    expect(page.cursor).toBe(encodeCursor(lastKey));
  });
});

describe('listByCategory', () => {
  it('narrows the status partition with a begins_with on the category prefix', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Items: [storedProduct] });

    await repository.listByCategory({ categoryId: 'c-1', limit: 10 });

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :gsi1pk AND begins_with(#gsi1sk, :gsi1skPrefix)',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
      ExpressionAttributeValues: {
        ':gsi1pk': 'PRODUCTS#STATUS#ACTIVE',
        ':gsi1skPrefix': 'CATEGORY#c-1#',
      },
      Limit: 10,
      ScanIndexForward: true,
    });
  });
});

describe('update', () => {
  it('rewrites the derived index keys and guards on the read updatedAt', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedProduct });
    send.mockResolvedValueOnce({
      Attributes: { ...storedProduct, name: 'Red Mug', normalizedName: 'red-mug' },
    });

    await repository.update('p-1', { name: 'Red Mug', priceCents: 1500 });

    expect(commandAt(send, 0)).toBeInstanceOf(GetCommand);
    const command = commandAt(send, 1);
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      TableName: TABLE,
      Key: { PK: 'PRODUCT#p-1', SK: 'META' },
      ConditionExpression: 'attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt',
      ReturnValues: 'ALL_NEW',
      ExpressionAttributeValues: {
        ':name': 'Red Mug',
        ':normalizedName': 'red-mug',
        ':priceCents': 1500,
        ':description': 'A mug',
        ':gsi1pk': 'PRODUCTS#STATUS#ACTIVE',
        ':gsi1sk': 'CATEGORY#c-1#NAME#red-mug#PRODUCT#p-1',
        ':updatedAt': FIXED_NOW,
        ':expectedUpdatedAt': '2026-08-02T00:00:00.000Z',
      },
    });
  });

  it('moves the item to another GSI1 partition when the status changes', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedProduct });
    send.mockResolvedValueOnce({ Attributes: { ...storedProduct, status: 'DRAFT' } });

    await repository.update('p-1', { status: 'DRAFT' });

    expect(commandAt(send, 1).input).toMatchObject({
      ExpressionAttributeValues: { ':gsi1pk': 'PRODUCTS#STATUS#DRAFT' },
    });
  });

  it('fails when the product does not exist', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    await expect(repository.update('missing', { priceCents: 1 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fails fast when the caller holds a stale updatedAt', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedProduct });

    await expect(
      repository.update('p-1', { priceCents: 1, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('turns a lost write race into a conflict', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedProduct });
    send.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(repository.update('p-1', { priceCents: 1 })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('deactivate', () => {
  it('archives the product so it leaves the active listing partition', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({ Item: storedProduct });
    send.mockResolvedValueOnce({ Attributes: { ...storedProduct, status: 'ARCHIVED' } });

    const product = await repository.deactivate('p-1');

    expect(commandAt(send, 1).input).toMatchObject({
      ExpressionAttributeValues: {
        ':status': 'ARCHIVED',
        ':gsi1pk': 'PRODUCTS#STATUS#ARCHIVED',
        ':gsi1sk': 'CATEGORY#c-1#NAME#blue-mug#PRODUCT#p-1',
      },
    });
    expect(product.status).toBe('ARCHIVED');
  });
});

describe('delete', () => {
  it('deletes the metadata item only when it exists', async () => {
    const { repository, send } = setup();
    send.mockResolvedValueOnce({});

    await repository.delete('p-1');

    const command = commandAt(send, 0);
    expect(command).toBeInstanceOf(DeleteCommand);
    expect(command.input).toEqual({
      TableName: TABLE,
      Key: { PK: 'PRODUCT#p-1', SK: 'META' },
      ConditionExpression: 'attribute_exists(PK)',
    });
  });

  it('reports a missing product as not found', async () => {
    const { repository, send } = setup();
    send.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(repository.delete('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
