package managedwebservice

import (
	"encoding/json"
	"strings"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestUpdateJournalAcceptsOnlyCurrentKindAndCarriesRuntimeBinding(t *testing.T) {
	t.Parallel()
	bindingJSON, bindingDigest, err := newRuntimeBinding("mws_update", "family-update", DeploymentContainer)
	if err != nil {
		t.Fatal(err)
	}
	release := containerUpdateRelease{
		TemplateSnapshotJSON: `{"schema_version":3}`, TemplateSnapshotSHA256: strings.Repeat("a", 64),
		RuntimeBindingJSON: bindingJSON, RuntimeBindingSHA256: bindingDigest,
	}
	journal := containerUpdateJournal{Kind: managedServiceUpdateJournalKind, Phase: updatePhasePreparing, Old: release, Target: release}
	raw, err := json.Marshal(journal)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeContainerUpdateJournal(string(raw))
	if err != nil || decoded.Old.RuntimeBindingSHA256 != bindingDigest || decoded.Target.RuntimeBindingJSON != bindingJSON {
		t.Fatalf("current update journal = %+v, err=%v", decoded, err)
	}
	journal.Kind = "redeven.managed_container_update.v1"
	raw, _ = json.Marshal(journal)
	if _, err := decodeContainerUpdateJournal(string(raw)); err == nil {
		t.Fatal("retired update journal kind was accepted")
	}
}

func TestServiceFromUpdateReleaseCommitsRuntimeBinding(t *testing.T) {
	t.Parallel()
	oldBinding, oldDigest, err := newRuntimeBinding("mws_update", "family-update", DeploymentContainer)
	if err != nil {
		t.Fatal(err)
	}
	targetBinding, targetDigest, err := newRuntimeBinding("mws_update", "family-update", DeploymentContainer)
	if err != nil {
		t.Fatal(err)
	}
	service := pfregistry.ManagedService{ServiceID: "mws_update", Deployment: string(DeploymentContainer), RuntimeBindingJSON: oldBinding, RuntimeBindingSHA256: oldDigest}
	updated := serviceFromUpdateRelease(service, containerUpdateRelease{RuntimeBindingJSON: targetBinding, RuntimeBindingSHA256: targetDigest})
	if updated.RuntimeBindingJSON != targetBinding || updated.RuntimeBindingSHA256 != targetDigest {
		t.Fatalf("updated Runtime binding = %q %q", updated.RuntimeBindingJSON, updated.RuntimeBindingSHA256)
	}
}

func TestHostMetadataUpdateUsesGenericTemplateContract(t *testing.T) {
	t.Parallel()
	current := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec service"}}
	raw, digest, err := canonicalTemplateSpec(current)
	if err != nil {
		t.Fatal(err)
	}
	service := pfregistry.ManagedService{Deployment: string(DeploymentHost), DesiredState: "stopped", ObservedState: "stopped", Version: "1.0.0", TemplateSnapshotJSON: raw, TemplateSnapshotSHA256: digest}
	target := current
	target.Host = &HostTemplateSpec{StartScript: "exec service --foreground"}
	if _, err := hostTemplateUpdatePatch(service, Template{Deployment: DeploymentHost, Revision: 2, Version: "1.0.0", Spec: &target}); err != nil {
		t.Fatalf("generic metadata update error = %v", err)
	}
	target.Host.InstallScript = "echo changed"
	if _, err := hostTemplateUpdatePatch(service, Template{Deployment: DeploymentHost, Revision: 3, Version: "1.0.0", Spec: &target}); managedErrorCode(err) != "UPDATE_UNSUPPORTED" {
		t.Fatalf("Runtime-changing metadata update error = %v", err)
	}
}
