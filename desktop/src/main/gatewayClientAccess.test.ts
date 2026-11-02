import {generateKeyPairSync} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {expect,it} from 'vitest';
import {decodeGatewayClientAccessPackage} from './gatewayClientAccess';
const now=1_800_000_000_000;
const key=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
const fixture={purpose:'redeven-gateway-client',version:1,access_code:'a'.repeat(32),gateway_id:'gateway',gateway_public_key:key,tls_root_pem:rootCertificates[0],expires_at_unix_ms:now+600_000};
const encode=(value:unknown)=>'rdgc1.'+Buffer.from(JSON.stringify(value)).toString('base64url');
it('retains scoped CA and exact Gateway identity in a client package',()=>{expect(decodeGatewayClientAccessPackage(encode(fixture),now)).toEqual(fixture);});
it('rejects Runtime invitations, expired packages, malformed trust and unknown fields',()=>{
 for(const patch of [{purpose:'redeven.gateway.enrollment.v1'},{version:2},{expires_at_unix_ms:now},{expires_at_unix_ms:now+660_001},{access_code:'short'},{tls_root_pem:key},{gateway_public_key:rootCertificates[0]},{unexpected:true},{tls_root_pem:fixture.tls_root_pem+fixture.tls_root_pem},{gateway_public_key:key+'ignored'}]){
  expect(()=>decodeGatewayClientAccessPackage(encode({...fixture,...patch}),now)).toThrow('valid, unexpired');
 }
 for(const value of ['runtime-invitation',encode(fixture)+'=',encode(fixture)+'.', 'rdgc1.'+'a'.repeat(32768)])expect(()=>decodeGatewayClientAccessPackage(value,now)).toThrow();
});
