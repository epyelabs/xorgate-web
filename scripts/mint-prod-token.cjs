// Mint a prod Cognito ID token headlessly.
//
// Lives in xorgate-web's tree so `amazon-cognito-identity-js` resolves. The prod
// pool client allows ALLOW_USER_SRP_AUTH and refresh-token auth only, so
// `admin-initiate-auth` with a password does not work and SRP is the path.
// Widening ExplicitAuthFlows to make this easier is deliberately NOT done: it
// would loosen a production pool's auth config for an agent's convenience.
//
// Usage: XG_EMAIL=… XG_PASSWORD_FILE=/path/to/secret node scripts/mint-prod-token.cjs
const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require('amazon-cognito-identity-js');

const UserPoolId = process.env.XG_POOL || 'us-east-1_RPLv99S54';
const ClientId = process.env.XG_CLIENT || 'm82st9mkv1cte7s39vcj507ot';
const Username = process.env.XG_EMAIL;
// Read from a file rather than the environment/argv so the secret never
// appears in a command line or a process listing.
const Password = process.env.XG_PASSWORD_FILE
  ? require('fs').readFileSync(process.env.XG_PASSWORD_FILE, 'utf8').trim()
  : process.env.XG_PASSWORD;

if (!Username || !Password) {
  console.error('Set XG_EMAIL and XG_PASSWORD');
  process.exit(2);
}

const user = new CognitoUser({ Username, Pool: new CognitoUserPool({ UserPoolId, ClientId }) });
user.setAuthenticationFlowType('USER_SRP_AUTH');
user.authenticateUser(new AuthenticationDetails({ Username, Password }), {
  onSuccess: (s) => { process.stdout.write(s.getIdToken().getJwtToken()); },
  onFailure: (e) => { console.error('AUTH_FAILED:', e.code || '', e.message || e); process.exit(1); },
  newPasswordRequired: () => { console.error('AUTH_FAILED: NEW_PASSWORD_REQUIRED'); process.exit(1); },
});
