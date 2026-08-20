import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface FakeDocumentClient {
  client: DynamoDBDocumentClient;
  send: jest.Mock;
}

/** A `DynamoDBDocumentClient` stand-in whose only job is to capture commands. */
export function createFakeDocumentClient(): FakeDocumentClient {
  const send = jest.fn();
  return { client: { send } as unknown as DynamoDBDocumentClient, send };
}

export interface CapturedCommand {
  input: Record<string, unknown>;
}

/** Returns the command object passed to the nth `send` call. */
export function commandAt(send: jest.Mock, index: number): CapturedCommand {
  const call: unknown = send.mock.calls[index];
  if (!Array.isArray(call) || call.length === 0) {
    throw new Error(`No command was sent at index ${index}`);
  }
  return call[0] as CapturedCommand;
}

export function conditionalCheckFailed(): Error {
  const error = new Error('The conditional request failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

export function transactionCanceled(codes: string[]): Error {
  const error = new Error('Transaction cancelled');
  error.name = 'TransactionCanceledException';
  Object.assign(error, { CancellationReasons: codes.map((code) => ({ Code: code })) });
  return error;
}

/** Fixed clock so command payloads are deterministic. */
export const FIXED_NOW = '2026-08-20T10:00:00.000Z';
export const fixedClock = (): string => FIXED_NOW;
