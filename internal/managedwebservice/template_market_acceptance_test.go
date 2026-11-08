package managedwebservice

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	template "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func sourceManager(t *testing.T) *Manager {
	t.Helper()
	scope, state := newManagedServiceTestScope(t)
	r, err := pfregistry.Open(filepath.Join(state, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return &Manager{registry: r, scope: scope, stateDir: state, closed: true}
}
func sourceSelection(p *TemplateSourcePreview) *SourceSelection {
	return &SourceSelection{CandidateID: p.CandidateID, SHA256: p.SHA256, ExpectedSHA256: p.ExpectedSHA256}
}
func TestDeletedMarketSourceCanBeImportedAgain(t *testing.T) {
	ctx := context.Background()
	m := sourceManager(t)
	snapshot := sourceSnapshot(t, "exec true")
	for _, request := range []string{"first-import", "second-import"} {
		preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot})
		if err != nil {
			t.Fatal(err)
		}
		imported, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: request, CandidateID: preview.CandidateID, SHA256: snapshot.SHA256})
		if err != nil {
			t.Fatal(err)
		}
		if request == "first-import" {
			if err := m.DeleteTemplate(ctx, imported.TemplateID); err != nil {
				t.Fatal(err)
			}
		}
	}
}
func TestMarketDeployReviewHasNoEffectsAndCommitsReceiptWithSource(t *testing.T) {
	ctx := context.Background()
	m := sourceManager(t)
	snapshot := sourceSnapshot(t, "exec true")
	expected := template.SourceExpectation{RepositoryID: snapshot.Source.RepositoryID, CommitSHA: snapshot.Source.CommitSHA, SHA256: snapshot.SHA256}
	wrong := expected
	wrong.RepositoryID++
	if _, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot, Expected: &wrong}); err == nil {
		t.Fatal("identity mismatch admitted")
	}
	preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot, Expected: &expected})
	if err != nil {
		t.Fatal(err)
	}
	req := CreateRequest{RequestID: "market-direct-install", TemplateID: preview.Template.TemplateID, Deployment: DeploymentHost, Source: sourceSelection(preview), SourceOwner: "owner"}
	other := req
	other.SourceOwner = "other"
	if _, err := m.PreflightInstall(ctx, other); err == nil {
		t.Fatal("another owner used preview")
	}
	plan, err := m.PreflightInstall(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
	if sources, _ := m.registry.ListManagedTemplateSources(ctx); len(sources) != 0 {
		t.Fatal("preflight installed source")
	}
	if _, err := os.Stat(m.sourceRoot()); !os.IsNotExist(err) {
		t.Fatal("preflight persisted executable bytes")
	}
	result, err := m.Create(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	source, verified, err := m.registry.GetServiceTemplateSource(ctx, result.Service.ServiceID)
	if err != nil || !verified || source.SHA256 != snapshot.SHA256 {
		t.Fatal(source, verified, err)
	}
	m.templateSources = nil
	m.installPlans = nil
	replay, err := m.Create(ctx, req)
	if err != nil || replay.Operation.OperationID != result.Operation.OperationID {
		t.Fatal("durable receipt depended on preview", err)
	}
	req.SourceOwner = "other"
	if _, err := m.Create(ctx, req); err == nil {
		t.Fatal("receipt crossed owner")
	}
	restarted := &Manager{registry: m.registry, scope: m.scope, stateDir: m.stateDir}
	if err := restarted.cleanupTemplateSourceOrphans(ctx); err != nil {
		t.Fatal(err)
	}
	stored, _ := m.registry.GetManagedService(ctx, result.Service.ServiceID)
	resolved, err := restarted.resolveCurrentRuntime(ctx, stored)
	if err != nil || resolved.Template.SourceSHA256 != snapshot.SHA256 {
		t.Fatal("restart lost pinned source", err)
	}
}
func TestMarketInstallTransactionRejectsStaleReviewWithoutInstance(t *testing.T) {
	ctx := context.Background()
	m := sourceManager(t)
	first := sourceSnapshot(t, "exec old")
	next := sourceSnapshot(t, "exec new")
	preview, _ := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &first})
	req := CreateRequest{RequestID: "market-stale-install", TemplateID: preview.Template.TemplateID, Source: sourceSelection(preview), SourceOwner: "owner"}
	plan, err := m.PreflightInstall(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
	newer, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &next})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "accept-newer-source", CandidateID: newer.CandidateID, SHA256: next.SHA256}); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Create(ctx, req); err == nil {
		t.Fatal("stale source installed")
	}
	if services, _ := m.registry.ListManagedServices(ctx); len(services) != 0 {
		t.Fatal("rejected install left a service")
	}
	if op, _ := m.registry.GetManagedOperationByRequestID(ctx, req.RequestID); op != nil {
		t.Fatal("rejected install left a receipt")
	}
	current, _ := m.registry.GetManagedTemplateSource(ctx, req.TemplateID)
	if current.SHA256 != next.SHA256 {
		t.Fatal("rejected install replaced source")
	}
}
func snapshotWithSpec(t *testing.T, spec TemplateSpec, revision int64) template.Snapshot {
	t.Helper()
	s := sourceSnapshot(t, "helper")
	raw, _ := json.Marshal(spec)
	doc := template.Document{Kind: template.Kind, SchemaVersion: 3, TemplateID: "sample", ServiceFamilyID: "sample", Revision: revision, DefaultLocale: "zh-CN", Locales: []string{"zh-CN"}, Spec: raw}
	s.Files[0].Content, _ = json.Marshal(doc)
	s.SHA256, _ = template.Digest(s.Files)
	return s
}
func TestSourceUpgradePinsInstancesAndRollsBackAllDeployments(t *testing.T) {
	for _, kind := range []Deployment{DeploymentHost, DeploymentContainer, DeploymentCompose} {
		for _, outcome := range []string{"commit", "rollback", "recovery", "repair", "stale"} {
			fail := outcome == "rollback"
			if kind == DeploymentHost && (outcome == "rollback" || outcome == "recovery") {
				continue
			}
			t.Run(string(kind)+"/"+outcome, func(t *testing.T) {
				ctx := context.Background()
				m := sourceManager(t)
				m.closed = false
				observer := &sourceUpgradeDriver{}
				m.host, m.container, m.compose = observer, observer, observer
				spec := TemplateSpec{SchemaVersion: 6, Kind: kind, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 8080}}
				switch kind {
				case DeploymentHost:
					spec.Host = &HostTemplateSpec{StartScript: "exec old"}
				case DeploymentContainer:
					spec.Container = &ContainerTemplateSpec{Image: "example/app:1@sha256:" + strings.Repeat("a", 64), Command: []string{"old"}}
				case DeploymentCompose:
					spec.Compose = &ComposeTemplateSpec{MainService: "app", YAML: "services:\n  app:\n    image: example/app:1\n    command: [old]\n"}
				}
				first := snapshotWithSpec(t, spec, 1)
				p, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &first})
				if err != nil {
					t.Fatal(err)
				}
				old, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "accept-old", CandidateID: p.CandidateID, SHA256: first.SHA256})
				if err != nil {
					t.Fatal(err)
				}
				cfg, cfgHash, _ := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
				rel, relHash, _ := canonicalReleaseIdentity(defaultReleaseIdentity(*old))
				service := pfregistry.ManagedService{ServiceID: "mws_pinned", TemplateID: old.TemplateID, WorkspacePath: filepath.Dir(m.stateDir), WorkspaceOwnership: "user_selected", ConfigurationJSON: cfg, ConfigurationSHA256: cfgHash, ConfigurationRevision: 1, ReleaseIdentityJSON: rel, ReleaseIdentitySHA256: relHash, ForwardID: "pf-pinned", DesiredState: "stopped", ObservedState: "stopped", RuntimeIdentity: "runtime-old", RuntimeManifestJSON: "{}", ArtifactReference: "example/app:1", RuntimePort: 39090}
				setTestRuntimeBinding(t, &service, old.ServiceFamilyID, kind)
				if err := m.registry.CreateManagedService(ctx, service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:39090"}); err != nil {
					t.Fatal(err)
				}
				servicePtr, _ := m.registry.GetManagedService(ctx, service.ServiceID)
				resolved, err := m.resolveCurrentRuntime(ctx, servicePtr)
				if err != nil {
					t.Fatal(err)
				}
				servicePtr.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
				m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeSpecSHA256: &resolved.RuntimeSpecSHA256})
				switch kind {
				case DeploymentHost:
					spec.Host.StartScript = "exec new"
				case DeploymentContainer:
					spec.Container.Command = []string{"new"}
				case DeploymentCompose:
					spec.Compose.YAML = strings.ReplaceAll(spec.Compose.YAML, "[old]", "[new]")
				}
				next := snapshotWithSpec(t, spec, 2)
				p, err = m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &next})
				if err != nil {
					t.Fatal(err)
				}
				updated, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "accept-new", CandidateID: p.CandidateID, SHA256: next.SHA256, ExpectedSHA256: first.SHA256})
				if err != nil {
					t.Fatal(err)
				}
				pinned, err := m.serviceTemplate(ctx, servicePtr)
				if err != nil || pinned.SourceSHA256 != first.SHA256 {
					t.Fatal("catalog update changed instance", err)
				}
				if _, err := os.Stat(old.SourceDirectory); err != nil {
					t.Fatal("bound source was collected", err)
				}
				if outcome == "repair" {
					// Reproduce the migration's unknown source history. Passive
					// settings must remain reachable while execution is blocked.
					db, err := sql.Open("sqlite", filepath.Join(m.stateDir, "registry.sqlite"))
					if err != nil {
						t.Fatal(err)
					}
					_, err = db.Exec(`UPDATE managed_web_service_source_bindings SET verified=0 WHERE service_id=?`, service.ServiceID)
					db.Close()
					if err != nil {
						t.Fatal(err)
					}
					unknownDigest := strings.Repeat("c", 64)
					if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeSpecSHA256: &unknownDigest}); err != nil {
						t.Fatal(err)
					}
					servicePtr.RuntimeSpecSHA256 = unknownDigest
					if _, err := m.resolveCurrentRuntime(ctx, servicePtr); err == nil {
						t.Fatal("unverified history was executable")
					}
					view, err := m.Settings(ctx, service.ServiceID)
					if err != nil || !view.SourceReviewRequired {
						t.Fatal("passive source repair unavailable", err)
					}
				}
				settings, err := m.TemplateSourceSettings(ctx, service.ServiceID, next.SHA256)
				if err != nil {
					t.Fatal(err)
				}
				draft := ReconfigureDraft{ConfigurationRevision: 1, TemplateSourceSHA256: next.SHA256, Parameters: settings.Parameters, Runtime: settings.Runtime}
				candidate, err := m.buildReconfigureCandidate(ctx, servicePtr, draft)
				if err != nil {
					t.Fatal(err)
				}
				if outcome == "stale" {
					third := snapshotWithSpec(t, spec, 3)
					latest, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &third})
					if err != nil {
						t.Fatal(err)
					}
					if _, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "accept-third", CandidateID: latest.CandidateID, SHA256: third.SHA256, ExpectedSHA256: next.SHA256}); err != nil {
						t.Fatal(err)
					}
					_, err = m.Operate(ctx, service.ServiceID, OperationRequest{RequestID: "stale-source-apply", Action: ActionReconfigure, Reconfigure: &ReconfigureRequest{Draft: draft, PlanDigest: candidate.Plan.PlanDigest}})
					code, _, _, _ := ErrorDetails(err)
					if code != "TEMPLATE_SOURCE_REVIEW_STALE" {
						t.Fatalf("stale review accepted: %v", err)
					}
					if op, _ := m.registry.GetManagedOperationByRequestID(ctx, "stale-source-apply"); op != nil {
						t.Fatal("stale review created operation")
					}
					bound, _, err := m.registry.GetServiceTemplateSource(ctx, service.ServiceID)
					if err != nil || bound.SHA256 != first.SHA256 {
						t.Fatal("stale review changed binding", err)
					}
					return
				}
				// Exercise the common stopped-runtime transaction and its recovery journal.
				candidate.Plan.RequiresRebuild = kind != DeploymentHost
				driver := &recordingReconfigureDriver{}
				if fail {
					driver.failFirstRebuild = errors.New("injected creation failure")
				}
				op := pfregistry.ManagedOperation{OperationID: "mop_source", ServiceID: service.ServiceID, RequestID: "apply-source", RequestFingerprint: "source", Action: "reconfigure", State: "running"}
				if err := m.registry.CreateManagedOperation(ctx, op); err != nil {
					t.Fatal(err)
				}
				if outcome == "recovery" {
					target := *servicePtr
					target.ConfigurationJSON, target.ConfigurationSHA256, target.ConfigurationRevision = candidate.JSON, candidate.SHA256, 2
					target.TemplateSourceSHA256, target.RuntimeIdentity = next.SHA256, "runtime-target"
					targetResolved, err := m.resolveCurrentRuntime(ctx, &target)
					if err != nil {
						t.Fatal(err)
					}
					journal := reconfigureJournal{Kind: reconfigureJournalKind, OperationID: op.OperationID, Phase: reconfigurePhaseTargetVerified,
						Old:    reconfigureRelease{TemplateSourceSHA256: first.SHA256, ConfigurationJSON: servicePtr.ConfigurationJSON, ConfigurationSHA256: servicePtr.ConfigurationSHA256, Revision: 1, RuntimeIdentity: servicePtr.RuntimeIdentity, RuntimeSpecSHA256: servicePtr.RuntimeSpecSHA256, RuntimeBindingJSON: servicePtr.RuntimeBindingJSON, RuntimeBindingSHA256: servicePtr.RuntimeBindingSHA256},
						Target: reconfigureRelease{TemplateSourceSHA256: next.SHA256, ConfigurationJSON: candidate.JSON, ConfigurationSHA256: candidate.SHA256, Revision: 2, RuntimeIdentity: "runtime-target", RuntimeSpecSHA256: targetResolved.RuntimeSpecSHA256, ArtifactReference: servicePtr.ArtifactReference, RuntimeBindingJSON: servicePtr.RuntimeBindingJSON, RuntimeBindingSHA256: servicePtr.RuntimeBindingSHA256}}
					if err := m.stageReconfigureSecrets(servicePtr.ServiceID, op.OperationID, serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion}, candidate.Secrets); err != nil {
						t.Fatal(err)
					}
					if err := m.writeReconfigureJournal(ctx, servicePtr.ServiceID, journal); err != nil {
						t.Fatal(err)
					}
					stored, _ := m.registry.GetManagedService(ctx, servicePtr.ServiceID)
					restarted := &Manager{registry: m.registry, scope: m.scope, stateDir: m.stateDir}
					if err := restarted.cleanupTemplateSourceOrphans(ctx); err != nil {
						t.Fatal(err)
					}
					err = restarted.recoverInterruptedReconfigure(stored, &op, driver)
				} else {
					err = m.runReconfigure(ctx, servicePtr, &op, driver, candidate)
				}
				if (err != nil) != fail {
					t.Fatal("unexpected outcome", err)
				}
				stored, _ := m.registry.GetManagedService(ctx, service.ServiceID)
				bound, verified, err := m.registry.GetServiceTemplateSource(ctx, service.ServiceID)
				if err != nil || !verified {
					t.Fatal(err)
				}
				want := updated.SourceSHA256
				if fail {
					want = first.SHA256
				}
				if bound.SHA256 != want {
					t.Fatal("source binding disagrees with commit", bound.SHA256, want)
				}
				resolved, err = m.resolveCurrentRuntime(ctx, stored)
				if err != nil {
					t.Fatal(err)
				}
				if kind != DeploymentHost && resolved.RuntimeSpecSHA256 != stored.RuntimeSpecSHA256 {
					t.Fatal("runtime and source digest disagree")
				}
				if stored.ConfigurationRevision != map[bool]int64{true: 1, false: 2}[fail] {
					t.Fatal("configuration/source transaction separated")
				}
			})
		}
	}
}

type sourceUpgradeDriver struct{ recordingReconfigureDriver }

func (*sourceUpgradeDriver) Observe(context.Context, *pfregistry.ManagedService) (bool, error) {
	return false, nil
}
