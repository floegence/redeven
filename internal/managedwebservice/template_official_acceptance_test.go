package managedwebservice

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	"github.com/floegence/redeven/internal/templatemarket"
)

// Explicit live qualification uses the production catalog, published source
// reader and real application packages. It never substitutes fixture services.
func TestOfficialTemplateMarketLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_OFFICIAL_TEMPLATE_TEST") != "1" {
		t.Skip("explicit live official-template acceptance")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	market := &templatemarket.Service{Path: filepath.Join(t.TempDir(), "market.json")}
	catalog, err := market.Refresh(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cached := market.Cached()
	if len(cached.Items) != len(catalog.Items) || cached.Generation != catalog.Generation {
		t.Fatal("catalog cache differs")
	}
	client := templatecontract.GitHubClient{}
	discovered, err := client.Discover(ctx, templatecontract.GitSource{Repository: "floegence/redeven-service-templates", Ref: "main"}, os.Getenv("GITHUB_TOKEN"))
	if err != nil {
		t.Fatal(err)
	}
	indexed := map[string]templatemarket.Item{}
	for _, item := range catalog.Items {
		if item.Classification == "official" {
			indexed[item.Source.Path] = item
		}
	}
	if len(indexed) != len(discovered.Templates) || len(indexed) == 0 {
		t.Fatalf("official source/catalog mismatch: %d/%d", len(discovered.Templates), len(indexed))
	}
	for _, entry := range discovered.Templates {
		item, ok := indexed[entry.Path]
		if !ok {
			t.Fatalf("undiscovered official directory: %s", entry.Path)
		}
		t.Run(item.DocumentTemplateID, func(t *testing.T) {
			if item.Status != "available" || item.Source.CommitSHA != discovered.Source.CommitSHA {
				t.Fatal("official catalog is not current")
			}
			home, _ := os.UserHomeDir()
			root, err := os.MkdirTemp(home, ".redeven-official-acceptance-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.RemoveAll(root) })
			m := openDockerManagementTest(t, root, false)
			expected := templatecontract.SourceExpectation{RepositoryID: item.Source.RepositoryID, CommitSHA: item.Source.CommitSHA, SHA256: item.SHA256}
			snapshot, err := client.CapturePinned(ctx, templatecontract.GitSource{Repository: item.Source.Repository, Ref: item.Source.Ref, Path: item.Source.Path}, expected, os.Getenv("GITHUB_TOKEN"))
			if err != nil {
				t.Fatal(err)
			}
			evidence, err := templatecontract.InspectMarketTemplate(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if evidence.TemplateID != item.TemplateID || evidence.Revision != item.Revision || len(evidence.Localizations) != 10 {
				t.Fatal("market differs from source evidence")
			}
			if dir := os.Getenv("REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE"); dir != "" {
				raw, _ := json.Marshal(snapshot)
				if err := os.WriteFile(filepath.Join(dir, item.DocumentTemplateID+".snapshot.json"), raw, 0600); err != nil {
					t.Fatal(err)
				}
			}

			parsed, err := templatecontract.Read(snapshot.Files)
			if err != nil {
				t.Fatal(err)
			}
			if parsed.Spec.Container != nil && parsed.Spec.Container.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop {
				changed := snapshot
				changed.Files = append([]templatecontract.File(nil), snapshot.Files...)
				for i, file := range changed.Files {
					if file.Path == templatecontract.Filename {
						changed.Files[i].Content = append(append([]byte(nil), file.Content...), '\n')
					}
				}
				changed.SHA256, _ = templatecontract.Digest(changed.Files)
				if _, err := m.InspectTemplateSource(ctx, "official-acceptance", TemplateSourceInspectRequest{Snapshot: &changed}); err == nil {
					t.Fatal("official repository identity authorized changed privileged bytes")
				}
			}
			preview, err := m.InspectTemplateSource(ctx, "official-acceptance", TemplateSourceInspectRequest{Snapshot: &snapshot, Expected: &expected})
			if err != nil {
				t.Fatal(err)
			}
			file, err := m.PreviewTemplateSourceFile(ctx, "official-acceptance", preview.CandidateID, templatecontract.Filename)
			if err != nil || file.After == nil || file.After.Text == "" {
				t.Fatal("source review unavailable", err)
			}
			req := CreateRequest{RequestID: "official-install", TemplateID: preview.Template.TemplateID, Deployment: preview.Template.Deployment, Source: sourceSelection(preview), SourceOwner: "official-acceptance", WorkspacePath: filepath.Join(root, "workspace"), AcceptedNoticeRevisions: map[string]int64{}}
			for _, n := range preview.Template.Notices {
				if n.AcknowledgementRequired {
					req.AcceptedNoticeRevisions[n.ID] = n.Revision
				}
			}
			plan, err := m.PreflightInstall(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			if sources, _ := m.registry.ListManagedTemplateSources(ctx); len(sources) != 0 {
				t.Fatal("review installed source")
			}
			if _, err := os.Stat(m.sourceRoot()); !os.IsNotExist(err) {
				t.Fatal("review wrote executable source")
			}
			t.Logf("verified path=%s revision=%d commit=%s sha256=%s locales=%d", item.Source.Path, item.Revision, item.Source.CommitSHA, item.SHA256, len(evidence.Localizations))
			if os.Getenv("REDEVEN_OFFICIAL_TEMPLATE_NATIVE") != "1" {
				return
			}
			req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
			created, err := m.Create(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			id := created.Service.ServiceID
			t.Cleanup(func() {
				cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
				defer cancel()
				p, err := m.PreflightManagement(cleanupCtx, id, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
				if err != nil {
					t.Error(err)
					return
				}
				op, err := m.Operate(cleanupCtx, id, OperationRequest{RequestID: "official-cleanup", Action: ActionUninstall, PlanDigest: p.PlanDigest, DeleteData: true, DeleteWorkspace: true, Administrator: true})
				if err != nil {
					t.Error(err)
					return
				}
				dockerLifecycleOperation(t, cleanupCtx, m, op)
				services, _ := m.registry.ListManagedServices(cleanupCtx)
				if len(services) != 0 {
					t.Error("uninstall retained instance")
				}
			})
			t.Logf("owned service=%s port=%d root=%s", id, created.Service.RuntimePort, root)
			dockerLifecycleOperation(t, ctx, m, &created.Operation)
			service := dockerLifecycleService(t, ctx, m, id)
			dockerLifecycleHealthy(t, ctx, m, service)
			opened, err := m.OpenSession(ctx, id, OpenSessionRequest{RequestID: "official-browser-open"})
			if err != nil {
				t.Fatal(err)
			}
			if dir := os.Getenv("REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE"); dir != "" {
				input, _ := json.Marshal(map[string]any{"url": fmt.Sprintf("http://127.0.0.1:%d%s", service.RuntimePort, opened.AppPath), "screenshot": filepath.Join(dir, item.DocumentTemplateID+".png"), "authenticated": opened.ManagedEntrance != nil})
				command := exec.CommandContext(ctx, "node", "../envapp/ui_src/scripts/checkOfficialTemplatePage.mjs")
				command.Stdin = strings.NewReader(string(input))
				output, err := command.CombinedOutput()
				if err != nil {
					t.Fatalf("real application browser: %v %s", err, output)
				}
				t.Logf("browser: %s", strings.TrimSpace(string(output)))
			}

			bound, verified, err := m.registry.GetServiceTemplateSource(ctx, id)
			if err != nil || !verified || bound.SHA256 != item.SHA256 {
				t.Fatal("instance lost reviewed source", err)
			}

			reloaded, err := m.Template(ctx, preview.Template.TemplateID)
			if err != nil || reloaded.SourceSHA256 != item.SHA256 {
				t.Fatal("saved source lost its reviewed profile", err)
			}
			restarted := &Manager{registry: m.registry, scope: m.scope, stateDir: m.stateDir}
			if _, _, err := restarted.readSourceTemplateWithAvailability(ctx, *bound, false); err != nil {
				t.Fatal("restart could not restore reviewed source", err)
			}
			view, err := m.Inspect(ctx, id)
			if err != nil || view.Status != "running" || !view.Actions.Open.Available || view.PendingChanges {
				t.Fatalf("user-visible view: %+v %v", view, err)
			}
			op, err := m.Operate(ctx, id, OperationRequest{RequestID: "official-stop", Action: ActionStop})
			if err != nil {
				t.Fatal(err)
			}
			dockerLifecycleOperation(t, ctx, m, op)
			op, err = m.Operate(ctx, id, OperationRequest{RequestID: "official-start", Action: ActionStart})
			if err != nil {
				t.Fatal(err)
			}
			dockerLifecycleOperation(t, ctx, m, op)
			dockerLifecycleHealthy(t, ctx, m, dockerLifecycleService(t, ctx, m, id))
		})
	}
}
