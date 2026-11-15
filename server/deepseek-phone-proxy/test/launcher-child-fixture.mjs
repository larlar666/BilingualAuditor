// Offline-only fixture. No provider modules, ledger, external network, or real credentials.
import readline from 'node:readline';
import https from 'node:https';
import {X509Certificate} from 'node:crypto';
const mode = process.argv[2];
const lines = readline.createInterface({input: process.stdin});
const snapshot = {event:'PHONE_PROXY_CHECK_OK',policySha256:'a'.repeat(64),ledgerId:'00000000-0000-4000-8000-000000000001',ledgerInitialized:mode==='check-init',
  limits:{maxInputCodePoints:1000,maxAttempts:20,maxBudgetMicroCny:3000000},
  budget:{attempts:2,reservedMicroCny:300000,remainingAttempts:18,remainingReserveMicroCny:2700000},policyExpiresAt:new Date(Date.now()+3600000).toISOString()};
const emit = x => process.stdout.write(JSON.stringify(x)+'\n');
if (mode.startsWith('check')) {
  emit(snapshot);
  if(mode==='check-extra') console.log('SYNTHETIC_PRIVATE_OUTPUT');
  console.error('SYNTHETIC_PRIVATE_STDERR');
  lines.close(); process.stdin.destroy();
} else {
  let started=false, server;
  const sockets=new Set();
  const stop=()=>{ for(const socket of sockets) socket.destroy(); if(server) server.close(()=>process.exit(0)); else process.exit(0); };
  lines.on('line', async line => {
    const data=JSON.parse(line);
    if(!started) {
      if(data.event!=='START_PHONE_PROXY' || !data.apiKey || !data.accessToken || !data.privateKeyPem) process.exit(7);
      started=true;
      if(mode==='raw') { console.log(data.apiKey); return; }
      let pin='b'.repeat(64);
      if(mode==='tls') {
        server=https.createServer({cert:data.certificatePem,key:data.privateKeyPem},(_q,r)=>r.end('synthetic'));
        server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
        await new Promise(resolve=>server.listen(data.port,'127.0.0.1',resolve));
        // Real TLS validation uses only this ephemeral public certificate, without system trust changes.
        await new Promise((resolve,reject)=>{
          https.get(`https://127.0.0.1:${data.port}/`,{ca:data.certificatePem},r=>{r.resume();r.on('end',resolve);}).on('error',reject);
        });
        pin=new X509Certificate(data.certificatePem).fingerprint256.replaceAll(':','').toLowerCase();
      }
      emit({event:'PHONE_PROXY_READY',endpoint:`https://${data.bindAddress}:${data.port}/translate`,certificateSha256:pin,bindAddress:data.bindAddress,
        allowedClientAddress:data.allowedClientAddress,port:data.port,sessionId:'00000000-0000-4000-8000-000000000002',
        sessionExpiresAt:new Date(Date.now()+3600000).toISOString(),policyExpiresAt:data.policyExpiresAt,
        limits:snapshot.limits,budget:snapshot.budget,ledgerId:data.ledgerId});
    } else if(data.event==='STOP_PHONE_PROXY') { emit({event:'PHONE_PROXY_STOPPED',reason:'USER_STOP'}); lines.close(); process.stdin.destroy(); }
    else process.exit(8);
  });
  lines.on('close',stop);
}
