import { verify as verifySignature, X509Certificate } from 'node:crypto';

const REDEVEN_RELEASE_CERTIFICATE_IDENTITY_REGEXP =
  /^https:\/\/github\.com\/floegence\/redeven\/\.github\/workflows\/release\.yml@refs\/tags\/v.*$/u;
const REDEVEN_RELEASE_CERTIFICATE_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const X509_SEQUENCE_TAG = 0x30;
const X509_OBJECT_IDENTIFIER_TAG = 0x06;
const X509_OCTET_STRING_TAG = 0x04;
const X509_UTF8_STRING_TAG = 0x0c;
const X509_PRINTABLE_STRING_TAG = 0x13;
const X509_IA5_STRING_TAG = 0x16;
const X509_BMP_STRING_TAG = 0x1e;
const X509_EXTENSIONS_CONTEXT_TAG = 0xa3;
const X509_SAN_URI_TAG = 0x86;
const X509_SUBJECT_ALT_NAME_OID = '2.5.29.17';
const FULCIO_GITHUB_OIDC_ISSUER_OID = '1.3.6.1.4.1.57264.1.1';

const SIGSTORE_FULCIO_ROOT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB9zCCAXygAwIBAgIUALZNAPFdxHPwjeDloDwyYChAO/4wCgYIKoZIzj0EAwMw
KjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0y
MTEwMDcxMzU2NTlaFw0zMTEwMDUxMzU2NThaMCoxFTATBgNVBAoTDHNpZ3N0b3Jl
LmRldjERMA8GA1UEAxMIc2lnc3RvcmUwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAT7
XeFT4rb3PQGwS4IajtLk3/OlnpgangaBclYpsYBr5i+4ynB07ceb3LP0OIOZdxex
X69c5iVuyJRQ+Hz05yi+UF3uBWAlHpiS5sh0+H2GHE7SXrk1EC5m1Tr19L9gg92j
YzBhMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBRY
wB5fkUWlZql6zJChkyLQKsXF+jAfBgNVHSMEGDAWgBRYwB5fkUWlZql6zJChkyLQ
KsXF+jAKBggqhkjOPQQDAwNpADBmAjEAj1nHeXZp+13NWBNa+EDsDP8G1WWg1tCM
WP/WHPqpaVo0jhsweNFZgSs0eE7wYI4qAjEA2WB9ot98sIkoF3vZYdd3/VtWB5b9
TNMea7Ix/stJ5TfcLLeABLE4BNJOsQ4vnBHJ
-----END CERTIFICATE-----
`;

const SIGSTORE_FULCIO_INTERMEDIATE_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICGjCCAaGgAwIBAgIUALnViVfnU0brJasmRkHrn/UnfaQwCgYIKoZIzj0EAwMw
KjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0y
MjA0MTMyMDA2MTVaFw0zMTEwMDUxMzU2NThaMDcxFTATBgNVBAoTDHNpZ3N0b3Jl
LmRldjEeMBwGA1UEAxMVc2lnc3RvcmUtaW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0C
AQYFK4EEACIDYgAE8RVS/ysH+NOvuDZyPIZtilgUF9NlarYpAd9HP1vBBH1U5CV7
7LSS7s0ZiH4nE7Hv7ptS6LvvR/STk798LVgMzLlJ4HeIfF3tHSaexLcYpSASr1kS
0N/RgBJz/9jWCiXno3sweTAOBgNVHQ8BAf8EBAMCAQYwEwYDVR0lBAwwCgYIKwYB
BQUHAwMwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU39Ppz1YkEZb5qNjp
KFWixi4YZD8wHwYDVR0jBBgwFoAUWMAeX5FFpWapesyQoZMi0CrFxfowCgYIKoZI
zj0EAwMDZwAwZAIwPCsQK4DYiZYDPIaDi5HFKnfxXx6ASSVmERfsynYBiX2X6SJR
nZU84/9DZdnFvvxmAjBOt6QpBlc4J/0DxvkTCqpclvziL6BCCPnjdlIB3Pu3BxsP
mygUY7Ii2zbdCdliiow=
-----END CERTIFICATE-----
`;

type DERNode = Readonly<{
  tag: number;
  value_start: number;
  value_end: number;
  end: number;
}>;

const TRUSTED_RELEASE_CERTIFICATE_CHAIN = Object.freeze({
  root: new X509Certificate(SIGSTORE_FULCIO_ROOT_CERT_PEM),
  intermediate: new X509Certificate(SIGSTORE_FULCIO_INTERMEDIATE_CERT_PEM),
});

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function maybeDecodeBase64Text(rawText: string): Buffer | null {
  const normalized = rawText.replace(/\s+/gu, '');
  if (normalized === '' || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    return null;
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    return null;
  }
  if (decoded.toString('base64').replace(/=+$/u, '') !== normalized.replace(/=+$/u, '')) {
    return null;
  }
  return decoded;
}

function normalizePEMText(rawValue: Buffer | string): string {
  const text = compact(Buffer.isBuffer(rawValue) ? rawValue.toString('utf8') : rawValue);
  if (text.startsWith('-----BEGIN CERTIFICATE-----')) {
    return `${text}\n`;
  }
  const decoded = maybeDecodeBase64Text(text)?.toString('utf8').trim();
  if (!decoded || !decoded.startsWith('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Release manifest certificate asset was not a PEM certificate.');
  }
  return `${decoded}\n`;
}

function normalizeSignatureBytes(rawValue: Buffer | string): Buffer {
  const text = compact(Buffer.isBuffer(rawValue) ? rawValue.toString('utf8') : rawValue);
  const decoded = maybeDecodeBase64Text(text);
  if (decoded) {
    return decoded;
  }
  return Buffer.isBuffer(rawValue) ? rawValue : Buffer.from(text, 'utf8');
}

function readDERNode(buffer: Buffer, offset: number): DERNode {
  if (offset >= buffer.length) {
    throw new Error('Encountered truncated X509 structure.');
  }
  const lengthByte = buffer[offset + 1];
  if (lengthByte === undefined) {
    throw new Error('Encountered truncated X509 length.');
  }
  let headerLength = 2;
  let valueLength = 0;
  if ((lengthByte & 0x80) === 0) {
    valueLength = lengthByte;
  } else {
    const lengthBytes = lengthByte & 0x7f;
    if (lengthBytes < 1 || lengthBytes > 4 || offset + 2 + lengthBytes > buffer.length) {
      throw new Error('Encountered unsupported X509 length encoding.');
    }
    headerLength += lengthBytes;
    for (let index = 0; index < lengthBytes; index += 1) {
      valueLength = (valueLength << 8) | buffer[offset + 2 + index];
    }
  }
  const valueStart = offset + headerLength;
  const valueEnd = valueStart + valueLength;
  if (valueEnd > buffer.length) {
    throw new Error('Encountered truncated X509 value.');
  }
  return {
    tag: buffer[offset],
    value_start: valueStart,
    value_end: valueEnd,
    end: valueEnd,
  };
}

function readDERChildren(buffer: Buffer, node: DERNode): readonly DERNode[] {
  const children: DERNode[] = [];
  for (let offset = node.value_start; offset < node.value_end;) {
    const child = readDERNode(buffer, offset);
    children.push(child);
    offset = child.end;
  }
  return children;
}

function decodeObjectIdentifier(rawValue: Buffer): string {
  if (rawValue.length === 0) {
    throw new Error('Encountered empty X509 object identifier.');
  }
  const first = rawValue[0];
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let index = 1; index < rawValue.length; index += 1) {
    value = (value << 7) | (rawValue[index] & 0x7f);
    if ((rawValue[index] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  if ((rawValue[rawValue.length - 1] & 0x80) !== 0) {
    throw new Error('Encountered unterminated X509 object identifier.');
  }
  return parts.join('.');
}

function decodeASN1String(tag: number, rawValue: Buffer): string {
  switch (tag) {
    case X509_UTF8_STRING_TAG:
      return rawValue.toString('utf8');
    case X509_PRINTABLE_STRING_TAG:
    case X509_IA5_STRING_TAG:
      return rawValue.toString('ascii');
    case X509_BMP_STRING_TAG: {
      if (rawValue.length % 2 !== 0) {
        throw new Error('Encountered malformed BMPString extension value.');
      }
      let text = '';
      for (let index = 0; index < rawValue.length; index += 2) {
        text += String.fromCodePoint(rawValue.readUInt16BE(index));
      }
      return text;
    }
    default:
      throw new Error(`Unsupported X509 string tag 0x${tag.toString(16)}.`);
  }
}

function decodeExtensionText(rawValue: Buffer): string {
  try {
    const valueNode = readDERNode(rawValue, 0);
    if (valueNode.end === rawValue.length) {
      return decodeASN1String(valueNode.tag, rawValue.subarray(valueNode.value_start, valueNode.value_end));
    }
  } catch {
    // Fulcio custom extensions sometimes store text directly in the OCTET STRING.
  }
  const text = rawValue.toString('utf8').trim();
  if (text !== '') {
    return text;
  }
  throw new Error('Release manifest certificate extension did not contain readable text.');
}

function findCertificateExtensionValue(certificate: X509Certificate, extensionOID: string): Buffer | null {
  const certificateNode = readDERNode(certificate.raw, 0);
  const certificateChildren = readDERChildren(certificate.raw, certificateNode);
  const tbsCertificate = certificateChildren[0];
  if (!tbsCertificate || tbsCertificate.tag !== X509_SEQUENCE_TAG) {
    throw new Error('Release manifest certificate did not contain a TBSCertificate sequence.');
  }
  const tbsChildren = readDERChildren(certificate.raw, tbsCertificate);
  const extensionsNode = tbsChildren.find((child) => child.tag === X509_EXTENSIONS_CONTEXT_TAG);
  if (!extensionsNode) {
    return null;
  }
  const extensionsSequence = readDERChildren(certificate.raw, extensionsNode)[0];
  if (!extensionsSequence || extensionsSequence.tag !== X509_SEQUENCE_TAG) {
    throw new Error('Release manifest certificate extensions were malformed.');
  }
  for (const extensionNode of readDERChildren(certificate.raw, extensionsSequence)) {
    const extensionChildren = readDERChildren(certificate.raw, extensionNode);
    const oidNode = extensionChildren[0];
    const valueNode = extensionChildren.at(-1);
    if (!oidNode || !valueNode || oidNode.tag !== X509_OBJECT_IDENTIFIER_TAG || valueNode.tag !== X509_OCTET_STRING_TAG) {
      continue;
    }
    const oid = decodeObjectIdentifier(certificate.raw.subarray(oidNode.value_start, oidNode.value_end));
    if (oid === extensionOID) {
      return certificate.raw.subarray(valueNode.value_start, valueNode.value_end);
    }
  }
  return null;
}

function releaseWorkflowIdentityURI(certificate: X509Certificate): string | null {
  const sanValue = findCertificateExtensionValue(certificate, X509_SUBJECT_ALT_NAME_OID);
  if (!sanValue) {
    return null;
  }
  const sanSequence = readDERNode(sanValue, 0);
  if (sanSequence.tag !== X509_SEQUENCE_TAG) {
    throw new Error('Release manifest SAN extension was malformed.');
  }
  for (const entry of readDERChildren(sanValue, sanSequence)) {
    if (entry.tag === X509_SAN_URI_TAG) {
      return sanValue.subarray(entry.value_start, entry.value_end).toString('ascii');
    }
  }
  return null;
}

function releaseOIDCIssuer(certificate: X509Certificate): string | null {
  const issuerValue = findCertificateExtensionValue(certificate, FULCIO_GITHUB_OIDC_ISSUER_OID);
  if (!issuerValue) {
    return null;
  }
  return decodeExtensionText(issuerValue);
}

function verifyTrustedCertificateChain(certificate: X509Certificate): void {
  const { intermediate, root } = TRUSTED_RELEASE_CERTIFICATE_CHAIN;
  if (!certificate.checkIssued(intermediate) || !certificate.verify(intermediate.publicKey)) {
    throw new Error('Release manifest certificate was not issued by the trusted Sigstore Fulcio intermediate.');
  }
  if (!intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) {
    throw new Error('Trusted Sigstore Fulcio intermediate was not signed by the pinned Fulcio root.');
  }
}

export function verifyDesktopSSHReleaseManifestSignature(args: Readonly<{
  sumsText: string;
  signature: Buffer | string;
  certificate: Buffer | string;
}>): void {
  const certificate = new X509Certificate(normalizePEMText(args.certificate));
  verifyTrustedCertificateChain(certificate);

  const workflowIdentity = releaseWorkflowIdentityURI(certificate);
  if (!workflowIdentity || !REDEVEN_RELEASE_CERTIFICATE_IDENTITY_REGEXP.test(workflowIdentity)) {
    throw new Error('Release manifest certificate identity did not match the Redeven release workflow policy.');
  }

  const oidcIssuer = releaseOIDCIssuer(certificate);
  if (oidcIssuer !== REDEVEN_RELEASE_CERTIFICATE_OIDC_ISSUER) {
    throw new Error(`Release manifest certificate OIDC issuer did not match ${REDEVEN_RELEASE_CERTIFICATE_OIDC_ISSUER}.`);
  }

  if (!verifySignature('sha256', Buffer.from(args.sumsText, 'utf8'), certificate.publicKey, normalizeSignatureBytes(args.signature))) {
    throw new Error('Release manifest signature verification failed.');
  }
}
