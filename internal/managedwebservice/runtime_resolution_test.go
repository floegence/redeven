package managedwebservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func newRuntimeResolutionTestService(t *testing.T, spec TemplateSpec, release ReleaseIdentity, observedState string) (*Manager, *pfregistry.Registry, *pfregistry.ManagedService, pfregistry.ManagedTemplate) {
	t.Helper()
	home := t.TempDir()
	homeReal, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(homeReal, "workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(homeReal)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	manager, err := New(ManagerOptions{StateDir: filepath.Join(homeReal, ".redeven", "local-environment"), Registry: registry, Scope: scope})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Close() })

	specJSON, specDigest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	template := pfregistry.ManagedTemplate{
		TemplateID: "template-live-runtime", Name: "Live runtime", Source: "custom", Deployment: string(spec.Kind), Revision: 1,
		SpecJSON: specJSON, SpecSHA256: specDigest, ServiceFamilyID: "family-live-runtime",
	}
	if err := registry.CreateManagedTemplate(context.Background(), template); err != nil {
		t.Fatal(err)
	}
	configurationJSON, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	releaseJSON, releaseDigest, err := canonicalReleaseIdentity(release)
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{
		ServiceID: "mws_live_runtime", TemplateID: template.TemplateID, WorkspacePath: workspace, WorkspaceOwnership: workspaceOwnershipUserSelected,
		ConfigurationJSON: configurationJSON, ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
		ReleaseIdentityJSON: releaseJSON, ReleaseIdentitySHA256: releaseDigest,
		DesiredState: observedState, ObservedState: observedState, ForwardID: "pf-live-runtime", RuntimeManifestJSON: "{}", RuntimePort: 39192,
	}
	setTestRuntimeBinding(t, service, template.ServiceFamilyID, spec.Kind)
	if err := registry.CreateManagedService(context.Background(), *service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:39192"}); err != nil {
		t.Fatal(err)
	}
	return manager, registry, service, template
}

func updateRuntimeResolutionTestTemplate(t *testing.T, registry *pfregistry.Registry, template pfregistry.ManagedTemplate, spec TemplateSpec) pfregistry.ManagedTemplate {
	t.Helper()
	raw, digest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	template.Revision++
	template.SpecJSON, template.SpecSHA256 = raw, digest
	if err := registry.UpdateManagedTemplate(context.Background(), template); err != nil {
		t.Fatal(err)
	}
	return template
}

func TestResolveCurrentRuntimeUsesLiveTemplateAndKeepsSelectedRelease(t *testing.T) {
	t.Parallel()
	release := ReleaseIdentity{
		Kind: "oci", Source: "registry.example.invalid/team/app", Tag: "1.2.3", Digest: "sha256:" + strings.Repeat("a", 64),
	}
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer,
		Endpoint:   WebEndpointSpec{Scheme: "http", ContainerPort: 3000, Path: "/old"},
		Parameters: []TemplateParameter{{Name: "MODE", Label: "Mode", Type: "text", Default: "stable"}},
		Container: &ContainerTemplateSpec{
			Image: "registry.example.invalid/team/app:recommended", Command: []string{"serve", "--old"},
			Environment: map[string]string{"MODE": "${MODE}"},
		},
	}
	manager, registry, service, template := newRuntimeResolutionTestService(t, spec, release, "stopped")

	initial, err := manager.resolveCurrentRuntime(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	if initial.Release.Version != release.Version || initial.Release.Tag != release.Tag || initial.Spec.Container.Image != release.Source+":"+release.Tag+"@"+release.Digest {
		t.Fatalf("resolved release = %+v, image = %q", initial.Release, initial.Spec.Container.Image)
	}
	if initial.Configuration.Parameters["MODE"] != "stable" {
		t.Fatalf("resolved default configuration = %+v", initial.Configuration.Parameters)
	}
	views, err := manager.List(context.Background())
	if err != nil || len(views) != 1 || views[0].Deployment != DeploymentContainer || views[0].TemplateSource != "custom" {
		t.Fatalf("service presentation = %+v, err=%v", views, err)
	}
	encodedView, err := json.Marshal(views[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, retired := range []string{"service_family_id", "template_revision", "template_snapshot"} {
		if strings.Contains(string(encodedView), retired) {
			t.Fatalf("service API still exposes retired field %q: %s", retired, encodedView)
		}
	}

	template.Name = "Renamed live runtime"
	template.Revision++
	if err := registry.UpdateManagedTemplate(context.Background(), template); err != nil {
		t.Fatal(err)
	}
	metadataOnly, err := manager.resolveCurrentRuntime(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	if metadataOnly.RuntimeSpecSHA256 != initial.RuntimeSpecSHA256 {
		t.Fatalf("metadata-only template change altered runtime digest: %q != %q", metadataOnly.RuntimeSpecSHA256, initial.RuntimeSpecSHA256)
	}

	spec.Endpoint.Path = "/current"
	spec.Container.Image = "registry.example.invalid/team/app:next-recommendation"
	spec.Container.Command = []string{"serve", "--current"}
	template = updateRuntimeResolutionTestTemplate(t, registry, template, spec)
	current, err := manager.resolveCurrentRuntime(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	if current.RuntimeSpecSHA256 == initial.RuntimeSpecSHA256 || current.Spec.Endpoint.Path != "/current" || current.Spec.Container.Command[1] != "--current" {
		t.Fatalf("current runtime was not resolved from the edited template: %+v", current.Spec)
	}
	if !sameReleaseIdentity(current.Release, release) || current.Spec.Container.Image != release.Source+":"+release.Tag+"@"+release.Digest {
		t.Fatalf("template edit changed selected release: release=%+v image=%q", current.Release, current.Spec.Container.Image)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ReleaseIdentityJSON != service.ReleaseIdentityJSON || stored.ConfigurationJSON != service.ConfigurationJSON {
		t.Fatalf("runtime resolution mutated persisted instance state: %+v", stored)
	}
}

func TestResolveCurrentRuntimeRejectsNewRequiredParameterWithoutValue(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost,
		Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"},
	}
	manager, registry, service, template := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	spec.Parameters = []TemplateParameter{{Name: "NEW_REQUIRED", Label: "New required value", Type: "text", Required: true}}
	updateRuntimeResolutionTestTemplate(t, registry, template, spec)

	_, err := manager.resolveCurrentRuntime(context.Background(), service)
	if managedErrorCode(err) != "CURRENT_TEMPLATE_PARAMETERS_INCOMPATIBLE" {
		t.Fatalf("missing current-template parameter error = %v", err)
	}
}

func TestResolveCurrentRuntimeRejectsBindingTemplateMismatch(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost,
		Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"},
	}
	manager, _, service, _ := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	for _, test := range []struct {
		name       string
		family     string
		deployment Deployment
	}{
		{name: "family", family: "another-family", deployment: DeploymentHost},
		{name: "deployment", family: "family-live-runtime", deployment: DeploymentContainer},
	} {
		t.Run(test.name, func(t *testing.T) {
			copy := *service
			raw, digest, err := newRuntimeBinding(copy.ServiceID, test.family, test.deployment)
			if err != nil {
				t.Fatal(err)
			}
			copy.RuntimeBindingJSON, copy.RuntimeBindingSHA256 = raw, digest
			_, err = manager.resolveCurrentRuntime(context.Background(), &copy)
			if managedErrorCode(err) != "RUNTIME_TEMPLATE_INCOMPATIBLE" {
				t.Fatalf("binding mismatch error = %v", err)
			}
		})
	}
}

func TestUpdateTemplateRejectsDeploymentChangeWhileInstalled(t *testing.T) {
	t.Parallel()
	host := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost,
		Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"},
	}
	manager, registry, _, template := newRuntimeResolutionTestService(t, host, ReleaseIdentity{Kind: "none"}, "stopped")
	container := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer,
		Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3000}, Container: &ContainerTemplateSpec{Image: "example.invalid/app:1"},
	}
	_, err := manager.UpdateTemplate(context.Background(), template.TemplateID, TemplateWriteRequest{RequestID: "change-deployment", Name: template.Name, Spec: container})
	if managedErrorCode(err) != "TEMPLATE_DEPLOYMENT_IN_USE" {
		t.Fatalf("installed template deployment change error = %v", err)
	}
	stored, readErr := registry.GetManagedTemplate(context.Background(), template.TemplateID)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if stored.Deployment != string(DeploymentHost) || stored.Revision != template.Revision {
		t.Fatalf("rejected template update changed persisted template: %+v", stored)
	}
}

func TestUpdateTemplateSerializesRuntimeEditsWithManagedOperations(t *testing.T) {
	t.Parallel()
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost,
		Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"},
	}
	manager, registry, service, template := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	operation := pfregistry.ManagedOperation{
		OperationID: "mop_template_runtime_edit", ServiceID: service.ServiceID, RequestID: "template-runtime-edit-operation",
		RequestFingerprint: "start", Action: string(ActionStart), State: "pending", Stage: "environment_check",
	}
	if err := registry.CreateManagedOperation(context.Background(), operation); err != nil {
		t.Fatal(err)
	}

	metadata, err := manager.UpdateTemplate(context.Background(), template.TemplateID, TemplateWriteRequest{
		RequestID: "template-metadata-during-operation", Name: "Renamed template", Description: "Current metadata", Spec: spec,
	})
	if err != nil || metadata.Name != "Renamed template" {
		t.Fatalf("metadata update = %+v, err=%v", metadata, err)
	}
	spec.Endpoint.Path = "/changed-runtime"
	_, err = manager.UpdateTemplate(context.Background(), template.TemplateID, TemplateWriteRequest{
		RequestID: "template-runtime-during-operation", Name: metadata.Name, Description: metadata.Description, Spec: spec,
	})
	if managedErrorCode(err) != "TEMPLATE_OPERATION_CONFLICT" {
		t.Fatalf("Runtime update error = %v", err)
	}
	stored, err := registry.GetManagedTemplate(context.Background(), template.TemplateID)
	if err != nil || stored == nil {
		t.Fatalf("stored template = %+v, err=%v", stored, err)
	}
	storedSpec, err := verifiedTemplateSpec(stored.SpecJSON, stored.SpecSHA256)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != template.Revision+1 || storedSpec.Endpoint.Path == spec.Endpoint.Path {
		t.Fatalf("template changed during operation: revision=%d spec=%+v", stored.Revision, storedSpec)
	}
}

func TestHostShutdownDoesNotRequireCurrentTemplateExecution(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a local managed process")
	}
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost,
		Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"},
	}
	manager, registry, service, template := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	driver := manager.host.(*hostScriptDriver)
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })

	template.SpecSHA256 = strings.Repeat("0", 64)
	if err := registry.UpdateManagedTemplate(context.Background(), template); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.resolveCurrentRuntime(context.Background(), service); err == nil {
		t.Fatal("corrupt current template unexpectedly resolved")
	}
	if err := driver.Shutdown(context.Background(), service); err != nil {
		t.Fatalf("identity-owned Host shutdown error = %v", err)
	}
	if managedProcessAlive(hostPIDFromIdentity(identity)) {
		t.Fatal("identity-owned Host process remained alive")
	}
}
