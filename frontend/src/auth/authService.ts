import { CognitoError, cognitoRequest, getClientId } from './cognitoClient';

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface RefreshedTokens {
  idToken: string;
  accessToken: string;
  expiresInSeconds: number;
}

interface AuthenticationResult {
  IdToken: string;
  AccessToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
}

interface InitiateAuthResponse {
  AuthenticationResult?: AuthenticationResult;
  ChallengeName?: string;
}

export async function signUp(email: string, password: string): Promise<{ userConfirmed: boolean }> {
  const result = await cognitoRequest<{ UserConfirmed: boolean }>('SignUp', {
    ClientId: getClientId(),
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
  return { userConfirmed: result.UserConfirmed };
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await cognitoRequest('ConfirmSignUp', {
    ClientId: getClientId(),
    Username: email,
    ConfirmationCode: code,
  });
}

export async function resendConfirmationCode(email: string): Promise<void> {
  await cognitoRequest('ResendConfirmationCode', { ClientId: getClientId(), Username: email });
}

/**
 * CartFlow's Cognito app client has no MFA and a single supported identity
 * provider (see `serverless.yml`), so `AuthenticationResult` is always
 * present on a valid credential match; a `ChallengeName` response here
 * would mean an unsupported flow (e.g. a forced password reset) rather
 * than something this app can complete.
 */
export async function signIn(email: string, password: string): Promise<AuthTokens> {
  const result = await cognitoRequest<InitiateAuthResponse>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: getClientId(),
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });

  if (result.AuthenticationResult === undefined) {
    throw new CognitoError(
      'Sign-in requires an additional step this app does not support yet. Contact support.',
      result.ChallengeName ?? 'ChallengeRequired',
    );
  }
  if (result.AuthenticationResult.RefreshToken === undefined) {
    throw new CognitoError(
      'The authentication service did not return a refresh token.',
      'MissingRefreshToken',
    );
  }

  return {
    idToken: result.AuthenticationResult.IdToken,
    accessToken: result.AuthenticationResult.AccessToken,
    refreshToken: result.AuthenticationResult.RefreshToken,
    expiresInSeconds: result.AuthenticationResult.ExpiresIn,
  };
}

export async function refreshSession(refreshToken: string): Promise<RefreshedTokens> {
  const result = await cognitoRequest<InitiateAuthResponse>('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: getClientId(),
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });

  if (result.AuthenticationResult === undefined) {
    throw new CognitoError(
      'Your session could not be refreshed. Please sign in again.',
      'RefreshFailed',
    );
  }

  return {
    idToken: result.AuthenticationResult.IdToken,
    accessToken: result.AuthenticationResult.AccessToken,
    expiresInSeconds: result.AuthenticationResult.ExpiresIn,
  };
}
