import {
  decodeCursor,
  encodeCursor,
  isConditionalCheckFailed,
  isTransactionConditionFailure,
  padQuantity,
} from '../../src/lib/dynamodb';
import { conditionalCheckFailed, transactionCanceled } from './helpers/fake-document-client';

describe('cursor encoding', () => {
  it('round-trips a LastEvaluatedKey through a URL-safe cursor', () => {
    const key = { PK: 'PRODUCT#p-1', SK: 'META', GSI1PK: 'PRODUCTS#STATUS#ACTIVE', GSI1SK: 'x' };
    const cursor = encodeCursor(key);

    expect(cursor).not.toBeNull();
    expect(cursor).not.toMatch(/[+/=]/);
    expect(decodeCursor(cursor)).toEqual(key);
  });

  it('returns null when DynamoDB reported no further pages', () => {
    expect(encodeCursor(undefined)).toBeNull();
  });

  it('treats an absent cursor as no ExclusiveStartKey', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(null)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
  });

  it('rejects cursors that are not base64 JSON objects', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow('Invalid pagination cursor');
    expect(() => decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toThrow(
      'Invalid pagination cursor',
    );
    expect(() => decodeCursor(Buffer.from('{}').toString('base64url'))).toThrow(
      'Invalid pagination cursor',
    );
  });

  it('rejects cursors carrying attributes that are not key attributes', () => {
    const tampered = Buffer.from(JSON.stringify({ PK: 'a', evil: 'b' })).toString('base64url');
    expect(() => decodeCursor(tampered)).toThrow('Invalid pagination cursor');
  });

  it('rejects cursors whose key values are not strings', () => {
    const tampered = Buffer.from(JSON.stringify({ PK: 1 })).toString('base64url');
    expect(() => decodeCursor(tampered)).toThrow('Invalid pagination cursor');
  });
});

describe('error classification', () => {
  it('detects conditional check failures', () => {
    expect(isConditionalCheckFailed(conditionalCheckFailed())).toBe(true);
    expect(isConditionalCheckFailed(new Error('boom'))).toBe(false);
    expect(isConditionalCheckFailed(undefined)).toBe(false);
  });

  it('detects cancelled transactions caused by a failed condition', () => {
    expect(
      isTransactionConditionFailure(transactionCanceled(['None', 'ConditionalCheckFailed'])),
    ).toBe(true);
    expect(isTransactionConditionFailure(transactionCanceled(['ThrottlingError']))).toBe(false);
    expect(isTransactionConditionFailure(conditionalCheckFailed())).toBe(false);
  });
});

describe('padQuantity', () => {
  it('pads so quantities sort lexicographically', () => {
    expect(padQuantity(7)).toBe('000000000007');
    expect(padQuantity(0)).toBe('000000000000');
    expect(padQuantity(-5)).toBe('000000000000');
    expect(padQuantity(12) < padQuantity(120)).toBe(true);
  });
});
