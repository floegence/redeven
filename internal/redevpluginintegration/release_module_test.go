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

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/releasecontract"
	"github.com/floegence/redevplugin/pkg/releasetrust"
)

func TestOfficialReleaseModuleIsCompleteAndClosed(t *testing.T) {
	module, ref, closeTrust, err := newOfficialReleaseModule(filepath.Join(t.TempDir(), "trust"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = closeTrust() })
	if module.Trust == nil || module.ReleaseArtifactResolver == nil || module.HostRequirements == nil || module.CapabilityContractArtifacts == nil {
		t.Fatalf("release module is incomplete: %#v", module)
	}

	provider := module.ReleaseArtifactResolver.(*officialReleaseProvider)
	policy := provider.sourcePolicy
	artifact, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: ref, SourcePolicy: policy,
	})
	if err != nil {
		t.Fatal(err)
	}
	if artifact.Size <= 0 || artifact.ArtifactSHA256 == ref.ExpectedHashes.PackageSHA256 {
		t.Fatalf("resolved artifact = size:%d sha:%s", artifact.Size, artifact.ArtifactSHA256)
	}

	tampered := ref
	tampered.ReleaseMetadataSHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: tampered, SourcePolicy: policy,
	}); !errors.Is(err, host.ErrReleaseRefVerificationFailed) {
		t.Fatalf("tampered release error = %v", err)
	}

	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := provider.ResolveCapabilityContract(context.Background(), host.CapabilityContractResolveRequest{
		SourceID: officialReleaseSourceID, PluginPublisherID: officialPublisherID, Pin: bundle.Pin, SourcePolicy: policy,
	})
	if err != nil || resolved.Artifacts == nil {
		t.Fatalf("embedded capability artifact resolution error = %v", err)
	}
	file, err := resolved.Artifacts.OpenCapabilityContractArtifact(context.Background(), bundle.Pin.ArtifactRef)
	if err != nil {
		t.Fatal(err)
	}
	if file.Size <= 0 || len(file.FetchChain) != 0 {
		t.Fatalf("embedded capability artifact evidence = %#v", file)
	}
}

func TestOfficialReleaseProviderReturnsOwnedArtifactBytes(t *testing.T) {
	provider, err := newOfficialReleaseProvider()
	if err != nil {
		t.Fatal(err)
	}
	policy := provider.sourcePolicy
	resolve := func() host.ResolvedPackageArtifact {
		artifact, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
			Action: host.PackageTrustActionInstall, ReleaseRef: provider.release.Ref, SourcePolicy: policy,
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

func TestOfficialReleaseTrustChainVerifies(t *testing.T) {
	module, ref, closeTrust, err := newOfficialReleaseModule(filepath.Join(t.TempDir(), "trust"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = closeTrust() })
	prepared, err := module.Trust.PrepareRelease(context.Background(), releasetrust.ReleaseIdentity{
		SourceID:              ref.SourceID,
		Channel:               ref.Channel,
		ReleaseMetadataRef:    ref.ReleaseMetadataRef,
		ReleaseMetadataSHA256: ref.ReleaseMetadataSHA256,
		PublisherID:           ref.PublisherID,
		PluginID:              ref.PluginID,
		Version:               ref.Version,
	})
	if err != nil {
		t.Fatalf("prepare official release trust: %v", err)
	}
	provider := module.ReleaseArtifactResolver.(*officialReleaseProvider)
	artifact, err := provider.ResolveReleaseArtifact(context.Background(), host.ReleaseArtifactResolveRequest{
		Action: host.PackageTrustActionInstall, ReleaseRef: ref, SourcePolicy: prepared.SourcePolicy(),
	})
	if err != nil {
		t.Fatalf("resolve official release artifact: %v", err)
	}
	verifiedMetadata, err := module.Trust.VerifyReleaseMetadata(
		context.Background(), prepared, artifact.ReleaseMetadataBytes, artifact.ReleaseMetadataSignature,
	)
	if err != nil {
		t.Fatalf("verify official release metadata: %v", err)
	}
	pkg, err := pluginpkg.Read(context.Background(), artifact.Reader, artifact.Size, pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatalf("read official package: %v", err)
	}
	if pkg.PackageSignature == nil {
		t.Fatal("official package signature is missing")
	}
	if _, err := module.Trust.VerifyPackage(context.Background(), verifiedMetadata, releasecontract.PackageSignatureV1(*pkg.PackageSignature)); err != nil {
		t.Fatalf("verify official package: %v", err)
	}
	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := module.Trust.VerifyCapabilityContract(verifiedMetadata, bundle, bundle.Pin); err != nil {
		t.Fatalf("verify official capability contract: %v", err)
	}
}

func TestOfficialContainersReleaseInstallsThroughHTTP(t *testing.T) {
	stateDir := t.TempDir()
	integration, err := New(context.Background(), Options{
		StateDir:         stateDir,
		PermissionPolicy: testPermissionPolicy(t, "execute_read_write"),
		RuntimePath:      filepath.Join(stateDir, "redevplugin-runtime"),
		Containers:       mustContainersAdapter(t, &capabilityEngineClient{}),
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
	if installed.Metadata["source.type"] != "host_artifact" ||
		installed.Metadata["release.metadata_signature_key_id"] != officialSigningKeyID ||
		installed.Metadata["release.package_signature_key_id"] != officialSigningKeyID {
		t.Fatalf("installed release metadata = %#v", installed.Metadata)
	}
}
