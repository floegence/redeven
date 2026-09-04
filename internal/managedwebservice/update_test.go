package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestUpdateJournalAcceptsOnlyCurrentKindAndCarriesRuntimeBinding(t *testing.T) {
	t.Parallel()
	bindingJSON, bindingDigest, err := newRuntimeBinding("mws_update", "family-update", DeploymentContainer)
	if err != nil {
		t.Fatal(err)
	}
	release := containerUpdateRelease{
		ConfigurationJSON: `{"schema_version":2}`, ConfigurationSHA256: strings.Repeat("a", 64),
		ReleaseIdentityJSON: `{"schema_version":1,"kind":"oci"}`, ReleaseIdentitySHA256: strings.Repeat("b", 64),
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
	journal.Kind = managedServiceUpdateJournalKind
	journal.Target.RuntimeSpecSHA256 = "not-a-runtime-digest"
	raw, _ = json.Marshal(journal)
	if _, err := decodeContainerUpdateJournal(string(raw)); err == nil {
		t.Fatal("malformed runtime digest was accepted")
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
	service := pfregistry.ManagedService{ServiceID: "mws_update", RuntimeBindingJSON: oldBinding, RuntimeBindingSHA256: oldDigest}
	updated := serviceFromUpdateRelease(service, containerUpdateRelease{RuntimeBindingJSON: targetBinding, RuntimeBindingSHA256: targetDigest})
	if updated.RuntimeBindingJSON != targetBinding || updated.RuntimeBindingSHA256 != targetDigest {
		t.Fatalf("updated Runtime binding = %q %q", updated.RuntimeBindingJSON, updated.RuntimeBindingSHA256)
	}
}

func TestMaterializeReleaseSpecKeepsSelectedVersionOnNewTemplateRevision(t *testing.T) {
	t.Parallel()
	template := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec service --foreground", NPM: &NPMHostPackageSpec{PackageName: "example-service", Version: "2.0.0", RegistryURL: "https://registry.npmjs.org/", Executable: "example-service"}}}
	selected := ReleaseIdentity{SchemaVersion: 1, Kind: "npm", Source: "example-service", Registry: "https://registry.npmjs.org/", Version: "1.0.0", Platform: currentPlatformKey()}
	materialized, err := materializeReleaseSpec(template, selected)
	if err != nil {
		t.Fatal(err)
	}
	if materialized.Host == nil || materialized.Host.NPM == nil || materialized.Host.NPM.Version != "1.0.0" || materialized.Host.StartScript != template.Host.StartScript {
		t.Fatalf("materialized spec = %+v", materialized)
	}
}

func TestRecoverInterruptedVerifiedContainerUpdateKeepsBuiltDigestAfterTemplateEdit(t *testing.T) {
	t.Parallel()
	manager, service, operation := reconfigureManagerForTest(t)
	target := *service
	target.DesiredState, target.ObservedState = "running", "running"
	target.RuntimeIdentity = "runtime-target"
	built, err := manager.resolveCurrentRuntime(context.Background(), &target)
	if err != nil {
		t.Fatal(err)
	}
	target.RuntimeSpecSHA256 = built.RuntimeSpecSHA256
	journal := containerUpdateJournal{
		Kind: managedServiceUpdateJournalKind, Phase: updatePhaseTargetVerified,
		Old: updateReleaseFromService(*service), Target: updateReleaseFromService(target),
	}

	record, err := manager.registry.GetManagedTemplate(context.Background(), service.TemplateID)
	if err != nil || record == nil {
		t.Fatalf("template = %+v, err=%v", record, err)
	}
	spec, err := verifiedTemplateSpec(record.SpecJSON, record.SpecSHA256)
	if err != nil {
		t.Fatal(err)
	}
	spec.Container.Command = []string{"edited-after-verification"}
	record.SpecJSON, record.SpecSHA256, err = canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	record.Revision++
	if err := manager.registry.UpdateManagedTemplate(context.Background(), *record); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(journal)
	if err != nil {
		t.Fatal(err)
	}
	manifest := string(raw)
	service.RuntimeManifestJSON = manifest
	if err := manager.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &manifest}); err != nil {
		t.Fatal(err)
	}
	operation.State = "interrupted"
	driver := &recordingContainerRollbackDriver{foundRuntime: target.RuntimeIdentity}
	if err := manager.recoverInterruptedContainerUpdate(service, operation, driver); err != nil {
		t.Fatal(err)
	}
	stored, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	current, err := manager.resolveCurrentRuntime(context.Background(), stored)
	if err != nil {
		t.Fatal(err)
	}
	if stored.RuntimeSpecSHA256 != built.RuntimeSpecSHA256 || stored.RuntimeSpecSHA256 == current.RuntimeSpecSHA256 {
		t.Fatalf("recovered digest=%q built=%q current=%q", stored.RuntimeSpecSHA256, built.RuntimeSpecSHA256, current.RuntimeSpecSHA256)
	}
	if stored.RuntimeIdentity != target.RuntimeIdentity || stored.ObservedState != "running" || stored.RuntimeManifestJSON != "{}" || driver.found != 1 || driver.verified != 0 || driver.started != 0 {
		t.Fatalf("recovered service=%+v, driver=%+v", stored, driver)
	}
}

func TestContainerUpdateRollbackRecordsTheRuntimeThatActuallyExists(t *testing.T) {
	for _, test := range []struct {
		name          string
		runtimeExists bool
		desiredState  string
		phase         string
		wantRebuilt   int
		wantRemoved   int
		wantStarted   int
		wantOldDigest bool
	}{
		{name: "preserve existing stopped runtime digest", runtimeExists: true, desiredState: "stopped", phase: updatePhasePreparing, wantOldDigest: true},
		{name: "record rebuilt stopped runtime digest", runtimeExists: false, desiredState: "stopped", phase: updatePhasePreparing, wantRebuilt: 1},
		{name: "preserve running runtime before it was stopped", runtimeExists: true, desiredState: "running", phase: updatePhaseArtifactReady, wantOldDigest: true},
		{name: "rebuild running runtime after it was stopped", runtimeExists: true, desiredState: "running", phase: updatePhaseOldStopped, wantRebuilt: 1, wantRemoved: 1, wantStarted: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			manager, service, _ := reconfigureManagerForTest(t)
			manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
			service.DesiredState, service.ObservedState = test.desiredState, test.desiredState
			oldDigest := service.RuntimeSpecSHA256
			record, err := manager.registry.GetManagedTemplate(context.Background(), service.TemplateID)
			if err != nil || record == nil {
				t.Fatalf("template = %+v, err=%v", record, err)
			}
			spec, err := verifiedTemplateSpec(record.SpecJSON, record.SpecSHA256)
			if err != nil {
				t.Fatal(err)
			}
			spec.Container.Command = []string{"current-template"}
			record.SpecJSON, record.SpecSHA256, err = canonicalTemplateSpec(spec)
			if err != nil {
				t.Fatal(err)
			}
			record.Revision++
			if err := manager.registry.UpdateManagedTemplate(context.Background(), *record); err != nil {
				t.Fatal(err)
			}
			current, err := manager.resolveCurrentRuntime(context.Background(), service)
			if err != nil {
				t.Fatal(err)
			}
			if current.RuntimeSpecSHA256 == oldDigest {
				t.Fatal("template runtime edit did not change the resolved digest")
			}

			journal := containerUpdateJournal{
				Kind: managedServiceUpdateJournalKind, Phase: test.phase,
				Old: updateReleaseFromService(*service), Target: updateReleaseFromService(*service),
			}
			journal.Target.RuntimeIdentity = ""
			if !test.runtimeExists {
				journal.Old.RuntimeIdentity = ""
			}
			driver := &recordingContainerRollbackDriver{}
			if test.runtimeExists {
				driver.foundRuntime = service.RuntimeIdentity
			}
			if err := manager.rollbackContainerUpdate(context.Background(), service, journal, driver); err != nil {
				t.Fatal(err)
			}
			stored, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
			if err != nil {
				t.Fatal(err)
			}
			wantDigest := current.RuntimeSpecSHA256
			if test.wantOldDigest {
				wantDigest = oldDigest
			}
			if stored.RuntimeSpecSHA256 != wantDigest || driver.created != test.wantRebuilt || driver.removed != test.wantRemoved || driver.started != test.wantStarted {
				t.Fatalf("rollback runtime digest=%q create=%d remove=%d start=%d, want digest=%q create=%d remove=%d start=%d", stored.RuntimeSpecSHA256, driver.created, driver.removed, driver.started, wantDigest, test.wantRebuilt, test.wantRemoved, test.wantStarted)
			}
		})
	}
}

type recordingContainerRollbackDriver struct {
	recordingReconfigureDriver
	created      int
	found        int
	foundRuntime string
}

func (*recordingContainerRollbackDriver) PrepareUpdateArtifact(context.Context, TemplateSpec, operationProgress) (string, error) {
	return "", errors.New("unexpected artifact preparation")
}

func (d *recordingContainerRollbackDriver) CreateRuntime(context.Context, *pfregistry.ManagedService, TemplateSpec, string) (string, error) {
	d.created++
	return "runtime-rollback", nil
}

func (d *recordingContainerRollbackDriver) FindRuntime(context.Context, string) (string, error) {
	d.found++
	return d.foundRuntime, nil
}

func (*recordingContainerRollbackDriver) Stop(context.Context, *pfregistry.ManagedService) error {
	return nil
}

type updatePlanFixture struct {
	manager  *Manager
	registry *pfregistry.Registry
	service  pfregistry.ManagedService
}

func newUpdatePlanFixture(t *testing.T) updatePlanFixture {
	t.Helper()
	packument := map[string]any{
		"versions": map[string]any{
			"0.5.0":        map[string]any{"version": "0.5.0", "deprecated": "old release", "dist": map[string]string{"integrity": testNPMIntegrity("older")}, "engines": map[string]string{"node": ">=24 <27"}},
			"1.0.0":        map[string]any{"version": "1.0.0", "dist": map[string]string{"integrity": testNPMIntegrity("current")}, "engines": map[string]string{"node": ">=24 <27"}},
			"2.0.0":        map[string]any{"version": "2.0.0", "dist": map[string]string{"integrity": testNPMIntegrity("recommended")}, "engines": map[string]string{"node": ">=24 <27"}},
			"3.0.0-beta.1": map[string]any{"version": "3.0.0-beta.1", "dist": map[string]string{"integrity": testNPMIntegrity("preview")}, "engines": map[string]string{"node": ">=24 <27"}},
		},
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(response).Encode(packument)
	}))
	t.Cleanup(server.Close)

	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	home := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := New(ManagerOptions{StateDir: filepath.Join(home, ".redeven", "local-environment"), Registry: registry, Scope: scope})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Close() })
	manager.releaseClient = server.Client()

	makeSpec := func(version string) TemplateSpec {
		return TemplateSpec{
			SchemaVersion: templateSpecSchemaVersion,
			Kind:          DeploymentHost,
			Endpoint:      WebEndpointSpec{Scheme: "http", Path: "/", HealthPath: "/", StartupTimeout: 45},
			Host: &HostTemplateSpec{
				StartScript: `exec "$REDEVEN_INSTALL_EXECUTABLE" . --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT"`,
				NPM:         &NPMHostPackageSpec{PackageName: "example-service", Version: version, RegistryURL: server.URL, Executable: "example-service"},
			},
		}
	}
	targetSpec := makeSpec("2.0.0")
	targetSnapshot, targetSnapshotDigest, err := canonicalTemplateSpec(targetSpec)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.CreateManagedTemplate(context.Background(), pfregistry.ManagedTemplate{
		TemplateID: "template-release-plan", Name: "Release plan test", Source: "custom", Deployment: string(DeploymentHost), Revision: 2,
		SpecJSON: targetSnapshot, SpecSHA256: targetSnapshotDigest, ServiceFamilyID: "family-release-plan",
	}); err != nil {
		t.Fatal(err)
	}
	configurationJSON, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	currentRelease := ReleaseIdentity{
		SchemaVersion: 1, Kind: "npm", Source: "example-service", Registry: normalizedRegistryURL(server.URL), Version: "1.0.0",
		Integrity: testNPMIntegrity("current"), Platform: currentPlatformKey(), Trust: "user_configured_registry",
	}
	releaseJSON, releaseDigest, err := canonicalReleaseIdentity(currentRelease)
	if err != nil {
		t.Fatal(err)
	}
	bindingJSON, bindingDigest, err := newRuntimeBinding("mws-release-plan", "family-release-plan", DeploymentHost)
	if err != nil {
		t.Fatal(err)
	}
	service := pfregistry.ManagedService{
		ServiceID: "mws-release-plan", TemplateID: "template-release-plan",
		WorkspacePath: filepath.Join(home, "workspace"), WorkspaceOwnership: workspaceOwnershipUserSelected, ConfigurationJSON: configurationJSON,
		ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest, ReleaseIdentityJSON: releaseJSON, ReleaseIdentitySHA256: releaseDigest,
		RuntimeBindingJSON: bindingJSON, RuntimeBindingSHA256: bindingDigest, DesiredState: "running", ObservedState: "running",
		ForwardID: "pf-release-plan", RuntimeManifestJSON: "{}", RuntimePort: 3080,
	}
	if err := registry.CreateManagedService(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080", AccessMode: pfregistry.AccessModeUnifiedProxy}); err != nil {
		t.Fatal(err)
	}
	return updatePlanFixture{manager: manager, registry: registry, service: service}
}

func candidateByVersion(t *testing.T, result *ReleaseCandidateResult, version string) ReleaseCandidate {
	t.Helper()
	for _, candidate := range result.Candidates {
		if candidate.Version == version {
			return candidate
		}
	}
	t.Fatalf("release candidate %q not found in %+v", version, result.Candidates)
	return ReleaseCandidate{}
}

func TestUpdatePlanRequiresUserToSelectAnotherApplicationRelease(t *testing.T) {
	fixture := newUpdatePlanFixture(t)
	ctx := context.Background()

	if _, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{}); managedErrorCode(err) != "UPDATE_NOT_REQUIRED" {
		t.Fatalf("empty update error = %v", err)
	}

	candidates, err := fixture.manager.ServiceReleaseCandidates(ctx, fixture.service.ServiceID, ReleaseCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	target := candidateByVersion(t, candidates, "2.0.0")
	if !target.IsRecommended || !target.IsLatestStable || target.Relation != "newer" {
		t.Fatalf("recommended candidate markers = %+v", target)
	}
	plan, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{TargetCandidateID: target.CandidateID})
	if err != nil {
		t.Fatal(err)
	}
	if plan.SchemaVersion != updatePlanSchemaVersion || plan.TargetRelease.Version != "2.0.0" || plan.RequiresStopped || slicesContain(plan.RiskIDs, releaseRiskNonDefault) {
		t.Fatalf("recommended update plan = %+v", plan)
	}
	if !slicesContain(plan.RiskIDs, releaseRiskNPMScripts) {
		t.Fatalf("npm lifecycle risk hint missing from %v", plan.RiskIDs)
	}
}

func TestUpdatePlanAllowsDeprecatedDowngradeWithAdvisoryRisksButRequiresStoppedService(t *testing.T) {
	fixture := newUpdatePlanFixture(t)
	ctx := context.Background()
	candidates, err := fixture.manager.ServiceReleaseCandidates(ctx, fixture.service.ServiceID, ReleaseCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	older := candidateByVersion(t, candidates, "0.5.0")
	if !older.Selectable || !older.Deprecated || older.Relation != "older" {
		t.Fatalf("deprecated candidate = %+v", older)
	}
	plan, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{TargetCandidateID: older.CandidateID})
	if err != nil {
		t.Fatal(err)
	}
	for _, risk := range []string{releaseRiskNonDefault, releaseRiskDeprecated, releaseRiskDowngrade, releaseRiskNPMScripts} {
		if !slicesContain(plan.RiskIDs, risk) {
			t.Fatalf("risk hint %q missing from %v", risk, plan.RiskIDs)
		}
	}
	if !plan.RequiresStopped {
		t.Fatal("downgrade plan did not require a stopped service")
	}
	stored, err := fixture.registry.GetManagedService(ctx, fixture.service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.manager.resolveUpdatePlan(ctx, stored, plan.UpdatePlanID); managedErrorCode(err) != "UPDATE_REQUIRES_STOPPED" {
		t.Fatalf("running downgrade resolve error = %v", err)
	}
}

func TestUpdatePlanRejectsEmptyAndExpiredPlans(t *testing.T) {
	fixture := newUpdatePlanFixture(t)
	ctx := context.Background()
	if _, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{}); managedErrorCode(err) != "UPDATE_NOT_REQUIRED" {
		t.Fatalf("empty update error = %v", err)
	}
	candidates, err := fixture.manager.ServiceReleaseCandidates(ctx, fixture.service.ServiceID, ReleaseCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	target := candidateByVersion(t, candidates, "2.0.0")
	plan, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{TargetCandidateID: target.CandidateID})
	if err != nil {
		t.Fatal(err)
	}
	fixture.manager.releaseMu.Lock()
	cached := fixture.manager.updatePlans[plan.UpdatePlanID]
	cached.ExpiresAt = time.Now().Add(-time.Second)
	fixture.manager.updatePlans[plan.UpdatePlanID] = cached
	fixture.manager.releaseMu.Unlock()
	stored, err := fixture.registry.GetManagedService(ctx, fixture.service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.manager.resolveUpdatePlan(ctx, stored, plan.UpdatePlanID); managedErrorCode(err) != "UPDATE_PLAN_EXPIRED" {
		t.Fatalf("expired plan resolve error = %v", err)
	}
}

func TestReleaseCheckSummarySurvivesManagerRestartWithoutChangingCurrentRelease(t *testing.T) {
	fixture := newUpdatePlanFixture(t)
	ctx := context.Background()
	if _, err := fixture.manager.ServiceReleaseCandidates(ctx, fixture.service.ServiceID, ReleaseCandidateRequest{}); err != nil {
		t.Fatal(err)
	}
	restartHome := t.TempDir()
	restartScope, err := filesystemscope.NewDefaultRegistry(restartHome)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := New(ManagerOptions{StateDir: filepath.Join(restartHome, ".redeven", "local-environment"), Registry: fixture.registry, Scope: restartScope})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restarted.Close() })
	views, err := restarted.List(ctx)
	if err != nil || len(views) != 1 {
		t.Fatalf("restarted List() = %+v, err=%v", views, err)
	}
	status := views[0].ReleaseStatus
	if status.CurrentRelease == nil || status.CurrentRelease.Version != "1.0.0" {
		t.Fatalf("current release changed after restart: %+v", status)
	}
	if status.RecommendedRelease == nil || status.RecommendedRelease.Version != "2.0.0" || status.LatestStableRelease == nil || status.LatestStableRelease.Version != "2.0.0" {
		t.Fatalf("release summary after restart = %+v", status)
	}
	if status.CheckStatus != "fresh" || status.CheckedAtUnixMs == 0 {
		t.Fatalf("persisted check state = %+v", status)
	}
}

func TestSpecialReleaseRiskDoesNotBlockSelection(t *testing.T) {
	template := Template{Source: "builtin", RecommendedRelease: &ReleaseIdentity{Kind: "oci", Source: "registry.example/app", Tag: "1.0.0"}}
	selected := &cachedReleaseCandidate{
		Candidate: ReleaseCandidate{Channel: "special", Selectable: true},
		Identity:  ReleaseIdentity{Kind: "oci", Source: "registry.example/app", Tag: "nightly", Digest: testReleaseDigest("a")},
	}
	risks := updatePlanRiskHints(template, selected, &ReleaseIdentity{Kind: "oci", Source: "registry.example/app", Tag: "1.0.0", Digest: testReleaseDigest("b")}, selected.Identity, true, "unknown")
	for _, risk := range []string{releaseRiskNonRecommended, releaseRiskUnknownOrder} {
		if !slicesContain(risks, risk) {
			t.Fatalf("risk %q missing from %v", risk, risks)
		}
	}
}

func slicesContain(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
