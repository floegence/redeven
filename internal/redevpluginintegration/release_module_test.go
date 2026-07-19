package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/registry"
)

func TestOfficialReleaseModuleIsCompleteAndClosed(t *testing.T) {
	verifier, err := newPackageTrustVerifier()
	if err != nil {
		t.Fatal(err)
	}
	module, ref, err := newOfficialReleaseModule(verifier)
	if err != nil {
		t.Fatal(err)
	}
	if module.ReleaseMetadataVerifier == nil || module.RevocationVerifier == nil || module.ReleaseSourcePolicy == nil ||
		module.ReleaseArtifactResolver == nil || module.HostRequirements == nil || module.CapabilityContractArtifacts == nil || module.CapabilityContractKeys == nil {
		t.Fatalf("release module is incomplete: %#v", module)
	}

	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	provider := module.ReleaseSourcePolicy.(*officialReleaseProvider)
	policy, err := provider.ResolveReleaseSourcePolicy(context.Background(), host.ReleaseSourcePolicyRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: ref, Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if policy.SourceType != host.PackageSourceHostArtifact || policy.SourceClass != host.PackageSourceClassOfficial ||
		policy.AssessedAt != now.Format(time.RFC3339) || policy.RevocationEvidence == nil || policy.RevocationEvidence.VerifiedAt != now.Format(time.RFC3339) {
		t.Fatalf("official source policy = %#v", policy)
	}
	artifact, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: ref, SourcePolicySnapshot: policy,
	})
	if err != nil {
		t.Fatal(err)
	}
	if artifact.Size <= 0 || artifact.ArtifactSHA256 == ref.ExpectedHashes.PackageSHA256 {
		t.Fatalf("resolved artifact = size:%d sha:%s", artifact.Size, artifact.ArtifactSHA256)
	}

	tampered := ref
	tampered.ReleaseMetadataSHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := provider.ResolveReleaseSourcePolicy(context.Background(), host.ReleaseSourcePolicyRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: tampered, Now: now,
	}); !errors.Is(err, host.ErrReleaseRefVerificationFailed) {
		t.Fatalf("tampered release error = %v", err)
	}

	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	key, err := provider.ResolveCapabilityContractKey(context.Background(), host.CapabilityContractKeyRequest{
		SourceID: officialReleaseSourceID, PublisherID: officialPublisherID, KeyID: officialSigningKeyID, SourcePolicySnapshot: policy,
	})
	if err != nil || len(key) != 32 {
		t.Fatalf("capability key size = %d, err=%v", len(key), err)
	}
	if _, err := provider.ResolveCapabilityContract(context.Background(), host.CapabilityContractResolveRequest{
		SourceID: officialReleaseSourceID, PluginPublisherID: officialPublisherID, Pin: bundle.Pin, SourcePolicySnapshot: policy,
	}); !errors.Is(err, errCapabilityArtifactProvenanceUnavailable) {
		t.Fatalf("embedded capability cache-miss error = %v", err)
	}
}

func TestOfficialReleaseProviderReturnsOwnedArtifactBytes(t *testing.T) {
	provider, err := newOfficialReleaseProvider()
	if err != nil {
		t.Fatal(err)
	}
	policy := provider.sourcePolicy(time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC))
	resolve := func() host.ResolvedPackageArtifact {
		artifact, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
			Action: host.PackageTrustActionInstall, ReleaseRef: provider.release.Ref, SourcePolicySnapshot: policy,
		})
		if err != nil {
			t.Fatal(err)
		}
		return artifact
	}
	first := resolve()
	first.ReleaseMetadataBytes[0] ^= 0xff
	first.ReleaseMetadataSignature[0] ^= 0xff
	second := resolve()
	if bytes.Equal(first.ReleaseMetadataBytes, second.ReleaseMetadataBytes) || bytes.Equal(first.ReleaseMetadataSignature, second.ReleaseMetadataSignature) {
		t.Fatal("release artifact resolves share mutable byte slices")
	}
}

func TestOfficialContainersReleaseInstallsThroughHTTP(t *testing.T) {
	stateDir := t.TempDir()
	configPath := filepath.Join(stateDir, "config.json")
	if err := config.Save(configPath, &config.Config{PermissionPolicy: testPermissionPolicy(t, "execute_read_write")}); err != nil {
		t.Fatal(err)
	}
	integration, err := New(context.Background(), Options{
		StateDir:    stateDir,
		ConfigPath:  configPath,
		RuntimePath: filepath.Join(stateDir, "redevplugin-runtime"),
		Containers:  containers.NewAdapter(nil),
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) {
			if channelID != "ch_release" {
				return nil, false
			}
			return &session.Meta{
				ChannelID: channelID, EndpointID: "env_release", UserPublicID: "user_release",
				CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
			}, true
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = integration.Close() })

	release, err := redevpluginartifacts.OfficialContainersPluginRelease()
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{
		"plugin_instance_id": "plugini_official_containers",
		"release_ref":        release.Ref,
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/_redevplugin/api/plugins/install-release-ref", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionhop.HeaderChannelID, "ch_release")
	req.Header.Set("Origin", "https://env.example.test")
	req.Header.Set(csrfHeader, csrfProof)
	req.Host = "env.example.test"
	req = WithRouteRole(req, RouteRoleEnvTrusted)
	req, err = WithTrustedOrigin(req, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	integration.Handler().ServeHTTP(response, req)
	if response.Code < 200 || response.Code >= 300 {
		t.Fatalf("install release status = %d body=%s", response.Code, response.Body.String())
	}
	var envelope struct {
		OK   bool `json:"ok"`
		Data struct {
			PluginID   string              `json:"plugin_id"`
			Version    string              `json:"version"`
			TrustState registry.TrustState `json:"trust_state"`
			Metadata   map[string]string   `json:"metadata"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode install response: %v body=%s", err, response.Body.String())
	}
	installed := envelope.Data
	if installed.PluginID != officialContainersPluginID || installed.Version != officialContainersVersion || installed.TrustState != registry.TrustVerified {
		t.Fatalf("installed plugin = %#v", installed)
	}
	if installed.Metadata["source.type"] != string(host.PackageSourceHostArtifact) ||
		installed.Metadata["release.metadata_signature_key_id"] != officialSigningKeyID ||
		installed.Metadata["release.package_signature_key_id"] != officialSigningKeyID {
		t.Fatalf("installed release metadata = %#v", installed.Metadata)
	}
}
