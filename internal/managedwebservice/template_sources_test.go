package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	templatecontract "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sourceSnapshot(t *testing.T, script string) templatecontract.Snapshot {
	t.Helper()
	spec := TemplateSpec{SchemaVersion: 6, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: script}}
	raw, _ := json.Marshal(spec)
	doc := templatecontract.Document{Kind: templatecontract.Kind, SchemaVersion: 3, TemplateID: "sample", ServiceFamilyID: "sample", Revision: 1, DefaultLocale: "zh-CN", Locales: []string{"zh-CN"}, Spec: raw}
	declaration, _ := json.Marshal(doc)
	snapshot := templatecontract.Snapshot{Source: templatecontract.ResolvedSource{Repository: "example/repo", RepositoryID: 123, Ref: "develop", Path: "templates/sample", CommitSHA: strings.Repeat("a", 40)}, Files: []templatecontract.File{{Path: templatecontract.Filename, Mode: "100644", Content: declaration}, {Path: "locales/zh-CN.json", Mode: "100644", Content: []byte(`{"name":"示例","description":"验证默认语言"}`)}, {Path: "scripts/start.sh", Mode: "100755", Content: []byte(script)}}}
	snapshot.SHA256, _ = templatecontract.Digest(snapshot.Files)
	return snapshot
}

func TestSourceUpdatePreservesServiceAndRejectsActiveOperation(t *testing.T) {
	ctx := context.Background()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	scope, state := newManagedServiceTestScope(t)
	m := &Manager{registry: registry, scope: scope, stateDir: state}
	first := sourceSnapshot(t, "exec sample")
	preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &first})
	if err != nil {
		t.Fatal(err)
	}
	imported, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "source-initial", CandidateID: preview.CandidateID, SHA256: first.SHA256})
	if err != nil {
		t.Fatal(err)
	}
	binding := fmt.Sprintf(`{"schema_version":2,"service_family_id":%q,"deployment":"host","host":{"install_root":"instances/mws_existing/install","data_root":%q,"log_path":"instances/mws_existing/logs/service.log"}}`, imported.ServiceFamilyID, "families/"+imported.ServiceFamilyID+"/data")
	bindingHash := sha256.Sum256([]byte(binding))
	service := pfregistry.ManagedService{ServiceID: "mws_existing", TemplateID: imported.TemplateID, WorkspacePath: "/existing", WorkspaceOwnership: "user_selected", RuntimeBindingJSON: binding, RuntimeBindingSHA256: fmt.Sprintf("%x", bindingHash), ForwardID: "pf-existing", DesiredState: "running", ObservedState: "running", RuntimeIdentity: "unchanged-process", RuntimeSpecSHA256: strings.Repeat("c", 64), RuntimeManifestJSON: "{}", RuntimePort: 38080}
	if err := registry.CreateManagedService(ctx, service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:38080"}); err != nil {
		t.Fatal(err)
	}
	stored, _ := registry.GetManagedService(ctx, service.ServiceID)
	before, _ := json.Marshal(stored)
	next := sourceSnapshot(t, "exec new-sample")
	update, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{TemplateID: imported.TemplateID, Snapshot: &next})
	if err != nil {
		t.Fatal(err)
	}
	file, err := m.PreviewTemplateSourceFile(ctx, "owner", update.CandidateID, "scripts/start.sh")
	if err != nil || file.Before.Text != "exec sample" || file.After.Text != "exec new-sample" || file.After.Mode != "100755" {
		t.Fatal("review did not expose original script content and executable mode", err)
	}
	if _, err := m.PreviewTemplateSourceFile(ctx, "another-owner", update.CandidateID, "scripts/start.sh"); err == nil {
		t.Fatal("another session read a private source preview")
	}
	if _, err := m.PreviewTemplateSourceFile(ctx, "owner", update.CandidateID, "../outside"); err == nil {
		t.Fatal("file preview accepted a path outside the captured directory")
	}
	if len(update.AffectedServiceIDs) != 1 || update.AffectedServiceIDs[0] != service.ServiceID {
		t.Fatal("preview hid affected service")
	}
	req := TemplateSourceConfirmRequest{RequestID: "source-update", CandidateID: update.CandidateID, SHA256: next.SHA256, ExpectedSHA256: first.SHA256}
	op := pfregistry.ManagedOperation{OperationID: "op_existing", ServiceID: service.ServiceID, RequestID: "running-operation", RequestFingerprint: "operation", Action: "restart", State: "running", Stage: "restart"}
	if err := registry.CreateManagedOperation(ctx, op); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ConfirmTemplateSource(ctx, "owner", req); err == nil {
		t.Fatal("active operation allowed source overwrite")
	}
	op.State = "succeeded"
	if err := registry.UpdateManagedOperation(ctx, op); err != nil {
		t.Fatal(err)
	}
	updated, err := m.ConfirmTemplateSource(ctx, "owner", req)
	if err != nil {
		t.Fatal(err)
	}
	afterService, _ := registry.GetManagedService(ctx, service.ServiceID)
	after, _ := json.Marshal(afterService)
	if string(before) != string(after) {
		t.Fatal("source update changed installed release, process, binding, or service configuration")
	}
	if imported.SourceSHA256 == updated.SourceSHA256 {
		t.Fatal("source-only update did not change identity")
	}
	stale, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{TemplateID: imported.TemplateID, Snapshot: &first})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(updated.SourceDirectory, "scripts/start.sh"), []byte("outside-edit"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "source-stale", CandidateID: stale.CandidateID, SHA256: first.SHA256, ExpectedSHA256: next.SHA256}); err == nil {
		t.Fatal("outside file edit did not invalidate confirmation")
	}
}
func TestSourceImportPreservesOriginalsAndManualUpdate(t *testing.T) {
	ctx := context.Background()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	scope, state := newManagedServiceTestScope(t)
	catalog, err := LoadBuiltinCatalog()
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{registry: registry, scope: scope, stateDir: state, catalog: catalog}
	snapshot := sourceSnapshot(t, "exec sample")
	preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot})
	if err != nil {
		t.Fatal(err)
	}
	if row, _ := registry.GetManagedTemplateSource(ctx, preview.Template.TemplateID); row != nil {
		t.Fatal("preview changed active sources")
	}
	req := TemplateSourceConfirmRequest{RequestID: "source-import", CandidateID: preview.CandidateID, SHA256: snapshot.SHA256}
	if _, err := m.ConfirmTemplateSource(ctx, "another-owner", req); err == nil {
		t.Fatal("another session claimed candidate")
	}
	imported, err := m.ConfirmTemplateSource(ctx, "owner", req)
	if err != nil {
		t.Fatal(err)
	}
	if imported.Source != "git" || imported.DefaultLocale != "zh-CN" || imported.Editable || imported.SourceDirectory == "" {
		t.Fatalf("incorrect imported template: %+v", imported)
	}
	files, err := templatecontract.ReadDirectory(imported.SourceDirectory)
	if err != nil {
		t.Fatal(err)
	}
	digest, _ := templatecontract.Digest(files)
	if digest != snapshot.SHA256 {
		t.Fatal("original bytes or executable mode changed")
	}
	if _, err := m.ConfirmTemplateSource(ctx, "owner", req); err != nil {
		t.Fatal("confirmation retry failed", err)
	}
	next := sourceSnapshot(t, "exec newer-sample")
	update, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{TemplateID: imported.TemplateID, Snapshot: &next})
	if err != nil {
		t.Fatal(err)
	}
	current, err := m.Template(ctx, imported.TemplateID)
	if err != nil || current.SourceSHA256 != snapshot.SHA256 {
		t.Fatal("checking applied an update", err)
	}
	updated, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "source-update", CandidateID: update.CandidateID, SHA256: next.SHA256, ExpectedSHA256: snapshot.SHA256})
	if err != nil {
		t.Fatal(err)
	}
	if updated.TemplateID != imported.TemplateID || updated.ServiceFamilyID != imported.ServiceFamilyID {
		t.Fatal("updating changed local identity")
	}
	if _, err := os.Stat(imported.SourceDirectory); !os.IsNotExist(err) {
		t.Fatal("obsolete source directory was retained")
	}
	if rows, _ := registry.ListManagedServices(ctx); len(rows) != 0 {
		t.Fatal("import installed a service")
	}
	if err := os.WriteFile(filepath.Join(updated.SourceDirectory, "scripts/start.sh"), []byte("corrupted"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Template(ctx, updated.TemplateID); err == nil {
		t.Fatal("corrupt source was executable")
	}
	items, err := m.Catalog(ctx)
	if err != nil {
		t.Fatal("one corrupt source blocked the catalog", err)
	}
	found := false
	for _, item := range items {
		if item.TemplateID == updated.TemplateID {
			found = true
			if item.Available || item.Spec != nil {
				t.Fatal("corrupt source silently fell back")
			}
		}
	}
	if !found {
		t.Fatal("corrupt source disappeared")
	}
}

func TestSourceReviewsCancelExpireAndIsolateRepositoryNamespaces(t *testing.T) {
	ctx := context.Background()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	scope, state := newManagedServiceTestScope(t)
	m := &Manager{registry: registry, scope: scope, stateDir: state}
	original := sourceSnapshot(t, "exec sample")
	first, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &original})
	if err != nil {
		t.Fatal(err)
	}
	another := sourceSnapshot(t, "exec sample")
	another.Source.RepositoryID = 456
	another.Source.Repository = "another/repository"
	other, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &another})
	if err != nil {
		t.Fatal(err)
	}
	if first.Template.TemplateID == other.Template.TemplateID || first.Template.ServiceFamilyID == other.Template.ServiceFamilyID {
		t.Fatal("repositories shared a template or family namespace")
	}
	if err := m.DiscardTemplateSource(ctx, "owner", first.CandidateID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "discarded-review", CandidateID: first.CandidateID, SHA256: first.SHA256}); err == nil {
		t.Fatal("discarded review was committed")
	}
	candidate := m.templateSources[other.CandidateID]
	candidate.Preview.ExpiresAtUnixMs = 1
	m.templateSources[other.CandidateID] = candidate
	if _, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "expired-review", CandidateID: other.CandidateID, SHA256: other.SHA256}); err == nil {
		t.Fatal("expired review was committed")
	}
	if sources, _ := registry.ListManagedTemplateSources(ctx); len(sources) != 0 {
		t.Fatal("cancelled or expired review changed persistent state")
	}
	active, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &original})
	if err != nil {
		t.Fatal(err)
	}
	imported, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "active-source-import", CandidateID: active.CandidateID, SHA256: active.SHA256})
	if err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(m.sourceRoot(), "source_crash_before_commit")
	if err := templatecontract.WriteDirectory(orphan, original.Files); err != nil {
		t.Fatal(err)
	}
	restarted := &Manager{registry: registry, scope: scope, stateDir: state}
	if err := restarted.cleanupTemplateSourceOrphans(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("unclaimed pre-commit directory survived cleanup")
	}
	if _, err := os.Stat(imported.SourceDirectory); err != nil {
		t.Fatal("post-commit active directory was removed", err)
	}
	if _, err := restarted.Template(ctx, imported.TemplateID); err != nil {
		t.Fatal("active source did not survive recovery", err)
	}
}
