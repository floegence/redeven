package managedwebservice

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestCatalogResolveRequiresValidSignatureAndFixedVersion(t *testing.T) {
	t.Parallel()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	payload := catalogPayload{
		TemplateID: DeepSeekHarnessTemplateID,
		Version:    DeepSeekHarnessVersion,
		Platforms:  map[string]nativeArtifact{"darwin-arm64": {DownloadURL: defaultPackageOrigin + "/dsh.tar.gz", SHA256: strings.Repeat("a", 64), SizeBytes: 1024, ExecutableRelPath: "bin/dsh"}},
		Docker:     map[string]dockerArtifact{"linux-arm64": {Image: auditedDockerImage, Digest: "sha256:" + strings.Repeat("b", 64)}},
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	envelopeBytes := signedCatalogBytes(t, privateKey, payloadBytes)
	var response atomic.Value
	response.Store(envelopeBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(response.Load().([]byte)) }))
	defer server.Close()
	client := &catalogClient{client: server.Client(), catalogURL: server.URL, packageOrigin: defaultPackageOrigin, publicKey: publicKey, keyID: managedCatalogKeyID}

	resolved, err := client.resolve(context.Background())
	if err != nil || resolved.TemplateID != DeepSeekHarnessTemplateID || resolved.Version != DeepSeekHarnessVersion {
		t.Fatalf("resolved catalog = %+v, err=%v", resolved, err)
	}

	tamperedPayload := append([]byte(nil), payloadBytes...)
	tamperedPayload[len(tamperedPayload)-2] ^= 1
	tamperedEnvelope := signedCatalogBytes(t, privateKey, payloadBytes)
	var envelope signedCatalogEnvelope
	if err := json.Unmarshal(tamperedEnvelope, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Payload = base64.StdEncoding.EncodeToString(tamperedPayload)
	tamperedEnvelope, _ = json.Marshal(envelope)
	response.Store(tamperedEnvelope)
	if _, err := client.resolve(context.Background()); managedErrorCode(err) != "CATALOG_SIGNATURE_INVALID" {
		t.Fatalf("tampered signature error = %v", err)
	}

	response.Store(append(envelopeBytes, []byte(` {}`)...))
	if _, err := client.resolve(context.Background()); managedErrorCode(err) != "CATALOG_INVALID" {
		t.Fatalf("trailing catalog JSON error = %v", err)
	}
}

func TestValidateNativeArtifactRejectsUntrustedSourceAndUnsafeLayout(t *testing.T) {
	t.Parallel()
	client := http.DefaultClient
	valid := nativeArtifact{DownloadURL: defaultPackageOrigin + "/managed/dsh.tar.gz", SHA256: strings.Repeat("a", 64), SizeBytes: 1024, ExecutableRelPath: "bin/dsh"}
	if err := validateNativeArtifact(valid, client, defaultPackageOrigin); err != nil {
		t.Fatalf("valid native artifact: %v", err)
	}
	untrusted := valid
	untrusted.DownloadURL = "https://example.com/dsh.tar.gz"
	if err := validateNativeArtifact(untrusted, client, defaultPackageOrigin); managedErrorCode(err) != "PACKAGE_SOURCE_REJECTED" {
		t.Fatalf("untrusted package error = %v", err)
	}
	unsafe := valid
	unsafe.ExecutableRelPath = "../dsh"
	if err := validateNativeArtifact(unsafe, client, defaultPackageOrigin); managedErrorCode(err) != "CATALOG_INVALID" {
		t.Fatalf("unsafe package layout error = %v", err)
	}
}

func signedCatalogBytes(t *testing.T, privateKey ed25519.PrivateKey, payload []byte) []byte {
	t.Helper()
	envelope := signedCatalogEnvelope{SchemaVersion: 1, KeyID: managedCatalogKeyID, Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))}
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
