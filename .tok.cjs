const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require('amazon-cognito-identity-js');
global.fetch = fetch;
const pool = new CognitoUserPool({ UserPoolId: 'us-east-1_E6dkPNlZl', ClientId: '7v9p61d6286ap4gbfj0psfu9h6' });
const u = new CognitoUser({ Username: process.env.U, Pool: pool });
u.authenticateUser(new AuthenticationDetails({ Username: process.env.U, Password: process.env.P }), {
  onSuccess: (s) => { console.log(s.getIdToken().getJwtToken()); process.exit(0); },
  onFailure: (e) => { console.error('FAIL', e.message || e); process.exit(1); },
});
