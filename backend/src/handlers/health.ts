import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const baseHandler = async (): Promise<APIGatewayProxyStructuredResultV2> => ({
  statusCode: 200,
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ok: true,
    data: {
      status: 'ok',
    },
  }),
});

export const handler = middy(baseHandler).use(httpCors());
