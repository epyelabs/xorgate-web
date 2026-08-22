// Phase 0, section 0.5 step 5: prove the vended live credentials actually open
// an MQTT-over-WSS connection to xorgate PROD and receive the prod device's
// telemetry. Run from xorgate-web's tree so `mqtt` resolves.
const mqtt = require('mqtt');
const crypto = require('crypto');

const { AWS_ACCESS_KEY_ID: ak, AWS_SECRET_ACCESS_KEY: sk, AWS_SESSION_TOKEN: st } = process.env;
const region = 'us-east-1';
const host = process.env.XG_ENDPOINT;
const topic = process.env.XG_TOPIC;

// SigV4-presigned WSS URL for iotdevicegateway.
function sign(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest(); }
const now = new Date();
const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
const datestamp = amzdate.slice(0, 8);
const scope = `${datestamp}/${region}/iotdevicegateway/aws4_request`;
const qs0 = [
  'X-Amz-Algorithm=AWS4-HMAC-SHA256',
  `X-Amz-Credential=${encodeURIComponent(ak + '/' + scope)}`,
  `X-Amz-Date=${amzdate}`,
  'X-Amz-SignedHeaders=host',
].join('&');
const canonical = ['GET', '/mqtt', qs0, `host:${host}\n`, 'host', crypto.createHash('sha256').update('').digest('hex')].join('\n');
const toSign = ['AWS4-HMAC-SHA256', amzdate, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
let k = sign('AWS4' + sk, datestamp);
k = sign(k, region); k = sign(k, 'iotdevicegateway'); k = sign(k, 'aws4_request');
const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
const url = `wss://${host}/mqtt?${qs0}&X-Amz-Signature=${sig}&X-Amz-Security-Token=${encodeURIComponent(st)}`;

const client = mqtt.connect(url, { clientId: 'xgl-phase0-probe-' + crypto.randomBytes(4).toString('hex'), protocolVersion: 5, reconnectPeriod: 0 });
let got = 0;
const done = (code, msg) => { console.log(msg); try { client.end(true); } catch {} process.exit(code); };
setTimeout(() => done(got ? 0 : 1, got ? '' : 'TIMEOUT: connected but no telemetry within 45s'), 45000);
client.on('connect', () => {
  console.log('MQTT CONNECTED to', host);
  client.subscribe(topic, { qos: 0 }, (err) => {
    if (err) return done(1, 'SUBSCRIBE FAILED: ' + err.message);
    console.log('SUBSCRIBED to', topic);
  });
});
client.on('message', (t, payload) => {
  got++;
  const d = JSON.parse(payload.toString());
  const metrics = Object.keys(d).filter((x) => typeof d[x] === 'object' && d[x]);
  console.log(`MESSAGE #${got} on ${t} — ts=${d.ts} groups=[${metrics.join(', ')}]`);
  if (got >= 2) done(0, 'RECEIVED LIVE PROD TELEMETRY OVER MQTT-WSS');
});
client.on('error', (e) => done(1, 'MQTT ERROR: ' + e.message));
