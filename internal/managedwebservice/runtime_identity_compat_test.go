package managedwebservice

import (
	"context"
	"strings"
	"testing"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestOpeningRuleChangesDoNotChangeAppliedRuntimeIdentity(t *testing.T) {
	spec := TemplateSpec{SchemaVersion: 7, Kind: DeploymentContainer, Endpoint: WebEndpointSpec{Scheme: "http", Path: "/original", ContainerPort: 3080}, Container: &ContainerTemplateSpec{Image: "example.invalid/app:1"}}
	m, _, service, _ := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "oci", Source: "example.invalid/app", Tag: "1", Digest: "sha256:" + strings.Repeat("a", 64)}, "running")
	resolved, err := m.resolveCurrentRuntime(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	secrets, err := m.serviceSecretDocument(service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	original, err := currentRuntimeSpecDigest(resolved.Spec, resolved.Configuration, resolved.Release, resolved.Binding, secrets, service)
	if err != nil {
		t.Fatal(err)
	}
	changed := cloneTemplateSpec(resolved.Spec)
	changed.Endpoint.Path = ""
	changed.StartupURL = &templatecontract.StartupURLSpec{LinePrefix: "web: "}
	next, err := currentRuntimeSpecDigest(changed, resolved.Configuration, resolved.Release, resolved.Binding, secrets, service)
	if err != nil || next != original {
		t.Fatal("opening-only change requires a restart")
	}
	if openingRuleDigest(changed) == openingRuleDigest(resolved.Spec) {
		t.Fatal("opening source authority was lost")
	}
	// Freeze the original schema6 algorithm independently of the current executor.
	legacy := cloneTemplateSpec(resolved.Spec)
	legacy.SchemaVersion = 6
	old, err := runtimeSpecDigestDocument(1, legacy, resolved.Configuration, resolved.Release, resolved.Binding, secrets, service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeSpecSHA256 = old
	if !matchesFrozenRuntimeIdentity(resolved, secrets, service) {
		t.Fatal("historical applied identity rejected")
	}
	service.RuntimeSpecSHA256 = strings.Repeat("f", 64)
	if matchesFrozenRuntimeIdentity(resolved, secrets, service) {
		t.Fatal("unverified historical identity accepted")
	}
}

func TestFrozenRuntimeIdentityV1Fixture(t *testing.T) {
	spec := TemplateSpec{SchemaVersion: 6, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", Path: "/settings?tab=one"}, Host: &HostTemplateSpec{StartScript: "exec app", OpenScript: "printf current-url"}}
	config := serviceConfiguration{SchemaVersion: 2}
	release := ReleaseIdentity{Kind: "none"}
	binding := runtimeBinding{SchemaVersion: 2, ServiceFamilyID: "fixture", Deployment: DeploymentHost, Host: &hostRuntimeBinding{InstallRoot: "instances/mws_fixture/install", DataRoot: "instances/mws_fixture/data", LogPath: "instances/mws_fixture/logs/service.log"}}
	secrets := serviceSecrets{SchemaVersion: 1}
	service := &pfregistry.ManagedService{WorkspacePath: "/workspace/fixture", RuntimePort: 3080}
	got, err := runtimeSpecDigestDocument(1, spec, config, release, binding, secrets, service)
	if err != nil {
		t.Fatal(err)
	}
	const frozen = "bd33de9eb57fa77ef0386cf2deee2bf1ef0c70228057259e60f153445b687a75"
	if got != frozen {
		t.Fatalf("frozen identity v1 = %s", got)
	}
}

func TestSourceRuntimeFilesExcludeDocumentOnlyEdits(t *testing.T) {
	files := []templatecontract.File{{Path: templatecontract.Filename, Mode: "100644", Content: []byte("historical document")}, {Path: "scripts/start.sh", Mode: "100755", Content: []byte("exec app")}}
	original := templateRuntimeFilesDigest(files)
	files[0].Content = []byte("current document with updated entrance")
	if templateRuntimeFilesDigest(files) != original {
		t.Fatal("format or entrance-only update changed runtime source identity")
	}
	files[1].Content = []byte("exec other-app")
	if templateRuntimeFilesDigest(files) == original {
		t.Fatal("changed source script lost its runtime identity")
	}
}
