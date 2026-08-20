/**
 * A minimal client for Cognito's public, unauthenticated Identity Provider
 * API (SignUp, ConfirmSignUp, InitiateAuth, ResendConfirmationCode). These
 * specific operations are designed to be called directly from a browser
 * with no AWS credentials and no request signing — only the public app
 * client id — which is why AWS Amplify and amazon-cognito-identity-js can
 * run purely client-side. Calling the JSON API directly here avoids pulling
 * the full `@aws-sdk/client-cognito-identity-provider` (built for
 * general-purpose AWS API access, and heavier than this app needs) into the
 * browser bundle for four narrow, well-documented calls.
 *
 * The frontend never receives or holds AWS credentials — see
 * `docs/architecture.md`, "Authentication And Authorization".
 */

export class CognitoError extends Error {
  /** The Cognito exception name, e.g. `UsernameExistsException`. */
  readonly type: string;

  constructor(message: string, type: string) {
    super(message);
    this.name = 'CognitoError';
    this.type = type;
  }
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  UsernameExistsException: 'An account with this email already exists.',
  InvalidPasswordException:
    'Password must be at least 12 characters and include an uppercase letter, a lowercase letter, and a number.',
  InvalidParameterException: 'Some of the information provided is invalid.',
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UserNotConfirmedException: 'Please confirm your email before signing in.',
  CodeMismatchException: 'That confirmation code is incorrect.',
  ExpiredCodeException: 'That confirmation code has expired. Request a new one.',
  LimitExceededException: 'Too many attempts. Please wait a moment and try again.',
  TooManyRequestsException: 'Too many attempts. Please wait a moment and try again.',
};

interface CognitoErrorBody {
  __type?: string;
  message?: string;
}

function getEndpoint(): string {
  const region = import.meta.env.VITE_COGNITO_REGION;
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

export function getClientId(): string {
  return import.meta.env.VITE_COGNITO_APP_CLIENT_ID;
}

export async function cognitoRequest<T>(
  action: string,
  params: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(getEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(params),
    });
  } catch {
    throw new CognitoError(
      'Unable to reach the authentication service. Check your connection.',
      'NetworkError',
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CognitoError('Unexpected response from the authentication service.', 'UnknownError');
  }

  if (!response.ok) {
    const body = payload as CognitoErrorBody;
    const type = body.__type?.split('#').pop() ?? 'UnknownError';
    throw new CognitoError(
      FRIENDLY_MESSAGES[type] ?? body.message ?? 'Something went wrong. Please try again.',
      type,
    );
  }

  return payload as T;
}
