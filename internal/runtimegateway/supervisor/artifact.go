package supervisor

import (
	"context"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/url"
	"strings"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const (
	releaseCertificateIdentityPrefix = "https://github.com/floegence/redeven/.github/workflows/release.yml@refs/tags/"
	releaseCertificateOIDCIssuer     = "https://token.actions.githubusercontent.com"
)

var fulcioOIDCIssuerOID = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 57264, 1, 1}

const sigstoreFulcioRootPEM = `-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----`

const sigstoreFulcioIntermediatePEM = `-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----`

type ArtifactVerifier struct{}

type compatibilityManifest struct {
	SchemaVersion int    `json:"schema_version"`
	ReleaseSetID  string `json:"release_set_id"`
	Gateway       struct {
		Version      string   `json:"version"`
		SHA256       string   `json:"sha256"`
		Protocol     string   `json:"protocol"`
		Capabilities []string `json:"capabilities"`
	} `json:"gateway"`
	Runtime struct {
		Version            string   `json:"version"`
		SHA256             string   `json:"sha256"`
		ServiceProtocol    string   `json:"service_protocol"`
		CompatibilityEpoch int      `json:"compatibility_epoch"`
		Capabilities       []string `json:"capabilities"`
		Platform           string   `json:"platform"`
		Architecture       string   `json:"architecture"`
	} `json:"runtime"`
	Compatibility struct {
		DesktopGatewayProtocols  []string `json:"desktop_gateway_protocols"`
		GatewayRuntimeEpochs     []int    `json:"gateway_runtime_epochs"`
		UpgradeFromRuntimeEpochs []int    `json:"upgrade_from_runtime_epochs"`
		RequiredUpgradeOrder     []string `json:"required_upgrade_order"`
	} `json:"compatibility"`
}

type customBuildAttestation struct {
	OperationID       string `json:"operation_id"`
	LifecycleTargetID string `json:"lifecycle_target_id"`
	TargetGeneration  int64  `json:"target_generation"`
	BuildInputsDigest string `json:"build_inputs_digest"`
	ArtifactSHA256    string `json:"artifact_sha256"`
	Platform          string `json:"platform"`
	Architecture      string `json:"architecture"`
}

func (ArtifactVerifier) Verify(_ context.Context, operation gatewayprotocol.RuntimeOperation, metadata gatewayprotocol.RuntimeArtifactMetadata, _ string) error {
	switch operation.DesiredRuntime.ArtifactPolicy {
	case gatewayprotocol.ArtifactPolicyPublishedRelease:
		return verifyPublishedArtifact(operation, metadata)
	case gatewayprotocol.ArtifactPolicyCustomBuild:
		return verifyCustomBuildArtifact(operation, metadata)
	default:
		return errors.New("Runtime artifact policy is unsupported")
	}
}

func verifyPublishedArtifact(operation gatewayprotocol.RuntimeOperation, metadata gatewayprotocol.RuntimeArtifactMetadata) error {
	if len(metadata.ManifestJSON) == 0 || strings.TrimSpace(metadata.ManifestSignature) == "" || strings.TrimSpace(metadata.ManifestCertificate) == "" {
		return errors.New("published Runtime artifact is missing its signed compatibility manifest")
	}
	var manifest compatibilityManifest
	decoder := json.NewDecoder(strings.NewReader(string(metadata.ManifestJSON)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return fmt.Errorf("parse Runtime compatibility manifest: %w", err)
	}
	if err := validateCompatibilityManifest(operation, metadata, manifest); err != nil {
		return err
	}
	certificate, err := parseReleaseCertificate(metadata.ManifestCertificate)
	if err != nil {
		return err
	}
	releaseTag := operation.DesiredRuntime.Version
	if !strings.HasPrefix(releaseTag, "v") {
		releaseTag = "v" + releaseTag
	}
	if !certificateHasURI(certificate, releaseCertificateIdentityPrefix+releaseTag) {
		return errors.New("Runtime manifest certificate workflow identity is invalid")
	}
	if certificateOIDCIssuer(certificate) != releaseCertificateOIDCIssuer {
		return errors.New("Runtime manifest certificate OIDC issuer is invalid")
	}
	signature, err := decodeSignature(metadata.ManifestSignature)
	if err != nil {
		return err
	}
	if err := certificate.CheckSignature(x509.ECDSAWithSHA256, metadata.ManifestJSON, signature); err != nil {
		return errors.New("Runtime compatibility manifest signature is invalid")
	}
	return nil
}

func validateCompatibilityManifest(operation gatewayprotocol.RuntimeOperation, metadata gatewayprotocol.RuntimeArtifactMetadata, manifest compatibilityManifest) error {
	if manifest.SchemaVersion != 1 || strings.TrimSpace(manifest.ReleaseSetID) == "" ||
		manifest.Gateway.Protocol != gatewayprotocol.Version || !containsString(manifest.Gateway.Capabilities, "runtime_operations_v2") ||
		!containsString(manifest.Gateway.Capabilities, "manual_recovery_v1") ||
		normalizeVersion(manifest.Runtime.Version) != normalizeVersion(operation.DesiredRuntime.Version) ||
		normalizeSHA256(manifest.Runtime.SHA256) != normalizeSHA256(metadata.SHA256) ||
		manifest.Runtime.ServiceProtocol != gatewayprotocol.RuntimeServiceProtocolV2 ||
		manifest.Runtime.CompatibilityEpoch != gatewayprotocol.RuntimeCompatibilityEpochV2 ||
		!containsString(manifest.Runtime.Capabilities, "lifecycle_fence_v1") ||
		strings.ToLower(strings.TrimSpace(manifest.Runtime.Platform)) != operation.DesiredRuntime.Platform ||
		strings.ToLower(strings.TrimSpace(manifest.Runtime.Architecture)) != operation.DesiredRuntime.Architecture ||
		!containsString(manifest.Compatibility.DesktopGatewayProtocols, gatewayprotocol.Version) ||
		!containsInt(manifest.Compatibility.GatewayRuntimeEpochs, gatewayprotocol.RuntimeCompatibilityEpochV2) ||
		len(manifest.Compatibility.RequiredUpgradeOrder) != 2 || manifest.Compatibility.RequiredUpgradeOrder[0] != "gateway" || manifest.Compatibility.RequiredUpgradeOrder[1] != "runtime" {
		return errors.New("Runtime compatibility manifest does not authorize this protocol, epoch, capability, platform, or artifact")
	}
	return nil
}

func verifyCustomBuildArtifact(operation gatewayprotocol.RuntimeOperation, metadata gatewayprotocol.RuntimeArtifactMetadata) error {
	if len(metadata.BuildAttestation) == 0 || len(operation.BuildInputs) == 0 {
		return errors.New("custom Runtime artifact is missing bound build inputs or attestation")
	}
	var attestation customBuildAttestation
	decoder := json.NewDecoder(strings.NewReader(string(metadata.BuildAttestation)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&attestation); err != nil {
		return errors.New("custom Runtime build attestation is invalid")
	}
	buildInputsDigest, err := canonicalBuildInputsDigest(operation.BuildInputs)
	if err != nil {
		return err
	}
	if attestation.OperationID != operation.OperationID || attestation.LifecycleTargetID != operation.LifecycleTargetID ||
		attestation.TargetGeneration != operation.TargetGeneration || attestation.BuildInputsDigest != buildInputsDigest ||
		normalizeSHA256(attestation.ArtifactSHA256) != normalizeSHA256(metadata.SHA256) ||
		strings.ToLower(strings.TrimSpace(attestation.Platform)) != operation.DesiredRuntime.Platform ||
		strings.ToLower(strings.TrimSpace(attestation.Architecture)) != operation.DesiredRuntime.Architecture {
		return errors.New("custom Runtime build attestation does not match the authorized operation")
	}
	return nil
}

func parseReleaseCertificate(raw string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(raw)))
	if block == nil || block.Type != "CERTIFICATE" {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
		if err == nil {
			block, _ = pem.Decode(decoded)
		}
	}
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("Runtime manifest certificate is invalid")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, err
	}
	intermediate, err := parsePinnedCertificate(sigstoreFulcioIntermediatePEM)
	if err != nil {
		return nil, err
	}
	root, err := parsePinnedCertificate(sigstoreFulcioRootPEM)
	if err != nil {
		return nil, err
	}
	if err := certificate.CheckSignatureFrom(intermediate); err != nil {
		return nil, errors.New("Runtime manifest certificate was not issued by the trusted Fulcio intermediate")
	}
	if err := intermediate.CheckSignatureFrom(root); err != nil {
		return nil, errors.New("pinned Fulcio intermediate is invalid")
	}
	return certificate, nil
}

func parsePinnedCertificate(raw string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, errors.New("pinned certificate is invalid")
	}
	return x509.ParseCertificate(block.Bytes)
}

func decodeSignature(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil && len(decoded) > 0 {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(value); err == nil && len(decoded) > 0 {
		return decoded, nil
	}
	return nil, errors.New("Runtime manifest signature encoding is invalid")
}

func certificateHasURI(certificate *x509.Certificate, expected string) bool {
	for _, value := range certificate.URIs {
		if value != nil && value.String() == expected {
			return true
		}
	}
	return false
}

func certificateOIDCIssuer(certificate *x509.Certificate) string {
	for _, extension := range certificate.Extensions {
		if !extension.Id.Equal(fulcioOIDCIssuerOID) {
			continue
		}
		var value string
		if _, err := asn1.Unmarshal(extension.Value, &value); err == nil {
			return strings.TrimSpace(value)
		}
		return strings.TrimSpace(string(extension.Value))
	}
	return ""
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == expected {
			return true
		}
	}
	return false
}

func containsInt(values []int, expected int) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

var _ = url.URL{}
