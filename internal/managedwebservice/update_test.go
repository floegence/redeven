package managedwebservice

import (
	"context"
	"encoding/json"
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
		TemplateSnapshotJSON: `{"schema_version":4}`, TemplateSnapshotSHA256: strings.Repeat("a", 64),
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
	currentSpec, targetSpec := makeSpec("1.0.0"), makeSpec("2.0.0")
	currentSnapshot, currentSnapshotDigest, err := canonicalTemplateSpec(currentSpec)
	if err != nil {
		t.Fatal(err)
	}
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
		ServiceID: "mws-release-plan", TemplateID: "template-release-plan", TemplateSource: "custom", TemplateRevision: 1,
		TemplateSnapshotJSON: currentSnapshot, TemplateSnapshotSHA256: currentSnapshotDigest, ServiceFamilyID: "family-release-plan",
		Deployment: string(DeploymentHost), WorkspacePath: filepath.Join(home, "workspace"), ConfigurationJSON: configurationJSON,
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

func TestUpdatePlanKeepsCurrentReleaseUnlessUserSelectsAnotherVersion(t *testing.T) {
	fixture := newUpdatePlanFixture(t)
	ctx := context.Background()

	plan, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if plan.TargetRelease.Version != "1.0.0" || plan.CurrentTemplateRevision != 1 || plan.TargetTemplateRevision != 2 {
		t.Fatalf("template-only plan = %+v", plan)
	}
	if plan.SchemaVersion != 2 || !slicesContain(plan.RiskIDs, releaseRiskNPMScripts) || slicesContain(plan.RiskIDs, releaseRiskNonDefault) {
		t.Fatalf("template-only risk hints = %+v", plan)
	}

	candidates, err := fixture.manager.ServiceReleaseCandidates(ctx, fixture.service.ServiceID, ReleaseCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	target := candidateByVersion(t, candidates, "2.0.0")
	if !target.IsRecommended || !target.IsLatestStable || target.Relation != "newer" {
		t.Fatalf("recommended candidate markers = %+v", target)
	}
	plan, err = fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{TargetCandidateID: target.CandidateID})
	if err != nil {
		t.Fatal(err)
	}
	if plan.TargetRelease.Version != "2.0.0" || plan.RequiresStopped || slicesContain(plan.RiskIDs, releaseRiskNonDefault) {
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
	currentRevision := int64(2)
	if err := fixture.registry.UpdateManagedService(ctx, fixture.service.ServiceID, pfregistry.ManagedServicePatch{TemplateRevision: &currentRevision}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{}); managedErrorCode(err) != "UPDATE_NOT_REQUIRED" {
		t.Fatalf("empty update error = %v", err)
	}
	oldRevision := int64(1)
	if err := fixture.registry.UpdateManagedService(ctx, fixture.service.ServiceID, pfregistry.ManagedServicePatch{TemplateRevision: &oldRevision}); err != nil {
		t.Fatal(err)
	}
	plan, err := fixture.manager.CreateUpdatePlan(ctx, fixture.service.ServiceID, UpdatePlanRequest{})
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
