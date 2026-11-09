package managedwebservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	templatecontract "github.com/floegence/redeven-service-templates/template"
)

// This opt-in product acceptance uses task-owned processes, workspaces and
// Docker resources. No repository script is executed during source review.
func TestMarketSourceNativeLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_TEMPLATE_MARKET_NATIVE_TEST") != "1" {
		t.Skip("explicit native template market acceptance")
	}
	runTemplateNativeLifecycle(t, false)
}
func TestPersonalCopyNativeLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_TEMPLATE_MARKET_NATIVE_TEST") != "1" {
		t.Skip("explicit native personal-template acceptance")
	}
	runTemplateNativeLifecycle(t, true)
}
func runTemplateNativeLifecycle(t *testing.T, personal bool) {
	for _, kind := range []Deployment{DeploymentHost, DeploymentContainer, DeploymentCompose} {
		t.Run(string(kind), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			home, _ := os.UserHomeDir()
			root, err := os.MkdirTemp(home, ".redeven-template-market-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.RemoveAll(root) })
			m := openDockerManagementTest(t, root, false)
			image := "busybox:1.36.1@" + os.Getenv("REDEVEN_TEMPLATE_MARKET_IMAGE_DIGEST")
			spec := TemplateSpec{SchemaVersion: 6, Kind: kind, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 8080, StartupTimeout: 15}}
			switch kind {
			case DeploymentHost:
				executable, _ := os.Executable()
				quote := "'" + strings.ReplaceAll(executable, "'", "'\"'\"'") + "'"
				spec.Host = &HostTemplateSpec{StartScript: "REDEVEN_MARKET_HTTP_HELPER=1 exec " + quote + " -test.run=^TestMarketHTTPHelper$"}
			case DeploymentContainer:
				spec.Container = &ContainerTemplateSpec{Image: image, Command: []string{"sh", "-c", "echo personal-template > /data/index.html; exec httpd -f -p 8080 -h /data"}, Mounts: []ContainerMountSpec{{ResourceID: "data", Type: "volume", Source: "data", Target: "/data"}}}
			case DeploymentCompose:
				spec.Compose = &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: " + image + "\n    command: [sh, -c, 'echo personal-template > /data/index.html; exec httpd -f -p 8080 -h /data']\n    volumes:\n      - data:/data\nvolumes:\n  data: {}\n"}
			}
			var helper string
			if personal && spec.Host != nil {
				helper = spec.Host.StartScript
				spec.Host.StartScript = `exec "$REDEVEN_TEMPLATE_DIR/scripts/start.sh"`
			}
			snapshot := snapshotWithSpec(t, spec, 1)
			if helper != "" {
				snapshot.Files[2].Content = []byte("#!/bin/sh\n" + helper)
				snapshot.SHA256, _ = templatecontract.Digest(snapshot.Files)
			}
			preview, err := m.InspectTemplateSource(ctx, "native", TemplateSourceInspectRequest{Snapshot: &snapshot})
			if err != nil {
				t.Fatal(err)
			}
			req := CreateRequest{RequestID: "market-native-install", TemplateID: preview.Template.TemplateID, Deployment: kind, Source: sourceSelection(preview), SourceOwner: "native", WorkspacePath: filepath.Join(root, "workspace")}
			if personal {
				copied, err := m.DuplicateTemplate(ctx, preview.Template.TemplateID, TemplateDuplicateRequest{RequestID: "native-personal-copy", Name: "My native service", Source: req.Source, SourceOwner: "native"})
				if err != nil {
					t.Fatal(err)
				}
				editedSpec := cloneTemplateSpec(*copied.Spec)
				switch kind {
				case DeploymentHost:
					editedSpec.Host.StartScript = "export PERSONAL_COPY=verified\n" + editedSpec.Host.StartScript
				case DeploymentContainer:
					editedSpec.Container.Environment = map[string]string{"PERSONAL_COPY": "verified"}
				case DeploymentCompose:
					editedSpec.Compose.YAML = strings.Replace(editedSpec.Compose.YAML, "    command:", "    environment:\n      PERSONAL_COPY: verified\n    command:", 1)
				}
				edited, err := m.UpdateTemplate(ctx, copied.TemplateID, TemplateWriteRequest{RequestID: "native-personal-edit", Name: "My edited native service", Description: "Independent native lifecycle", Spec: editedSpec})
				if err != nil {
					t.Fatal(err)
				}
				if err := m.DiscardTemplateSource(ctx, "native", preview.CandidateID); err != nil {
					t.Fatal(err)
				}
				if err := m.cleanupTemplateSourceOrphans(ctx); err != nil {
					t.Fatal(err)
				}
				reopened, err := m.Template(ctx, edited.TemplateID)
				if err != nil || reopened.Revision != 2 {
					t.Fatal("reopen edited copy", err)
				}
				preview.Template = *reopened
				req.TemplateID, req.Source = reopened.TemplateID, nil
			}
			if kind == DeploymentContainer {
				req.TargetReleaseID = dockerLifecycleCandidate(t, ctx, m, &preview.Template, templateReleaseScope(preview.Template, req.Source), "1.36.1", nil)
			}
			plan, err := m.PreflightInstall(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
			created, err := m.Create(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			id := created.Service.ServiceID
			t.Cleanup(func() {
				cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), time.Minute)
				defer cleanupCancel()
				p, err := m.PreflightManagement(cleanupCtx, id, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
				if err != nil {
					t.Error(err)
					return
				}
				op, err := m.Operate(cleanupCtx, id, OperationRequest{RequestID: "market-native-cleanup", Action: ActionUninstall, PlanDigest: p.PlanDigest, DeleteData: true, DeleteWorkspace: true, Administrator: true})
				if err != nil {
					t.Error(err)
					return
				}
				dockerLifecycleOperation(t, cleanupCtx, m, op)
			})
			dockerLifecycleOperation(t, ctx, m, &created.Operation)
			service := dockerLifecycleService(t, ctx, m, id)
			t.Logf("owned service=%s kind=%s port=%d state=%s", id, kind, service.RuntimePort, root)
			if kind != DeploymentHost {
				resources, err := m.registry.ListManagedServiceResources(ctx, id)
				if err != nil {
					t.Fatal(err)
				}
				if len(resources) == 0 {
					t.Fatal("data resource absent")
				}
			}
			op, err := m.Operate(ctx, id, OperationRequest{RequestID: "market-native-stop", Action: ActionStop})
			if err != nil {
				t.Fatal(err)
			}
			dockerLifecycleOperation(t, ctx, m, op)
			if !personal {
				// A helper-only edit must be part of the applied runtime source identity.
				next := snapshotWithSpec(t, spec, 2)
				next.Files[2].Content = []byte("reviewed helper revision 2")
				next.SHA256, _ = templatecontract.Digest(next.Files)
				p, err := m.InspectTemplateSource(ctx, "native", TemplateSourceInspectRequest{Snapshot: &next})
				if err != nil {
					t.Fatal(err)
				}
				if _, err = m.ConfirmTemplateSource(ctx, "native", TemplateSourceConfirmRequest{RequestID: "market-native-library-update", CandidateID: p.CandidateID, SHA256: next.SHA256, ExpectedSHA256: snapshot.SHA256}); err != nil {
					t.Fatal(err)
				}
				bound, _, _ := m.registry.GetServiceTemplateSource(ctx, id)
				if bound.SHA256 != snapshot.SHA256 {
					t.Fatal("library silently updated instance")
				}
				view, err := m.TemplateSourceSettings(ctx, id, next.SHA256)
				if err != nil {
					t.Fatal(err)
				}
				draft := ReconfigureDraft{ConfigurationRevision: view.ConfigurationRevision, TemplateSourceSHA256: next.SHA256, Parameters: view.Parameters, Runtime: view.Runtime}
				change, err := m.PreflightReconfigure(ctx, id, draft)
				if err != nil {
					t.Fatal(err)
				}
				risks := []string{}
				for _, risk := range change.Risks {
					risks = append(risks, risk.ID)
				}
				op, err = m.Operate(ctx, id, OperationRequest{RequestID: "market-native-upgrade", Action: ActionReconfigure, Reconfigure: &ReconfigureRequest{Draft: draft, PlanDigest: change.PlanDigest, AcceptedRiskIDs: risks, Administrator: true}})
				if err != nil {
					t.Fatal(err)
				}
				dockerLifecycleOperation(t, ctx, m, op)
				bound, _, _ = m.registry.GetServiceTemplateSource(ctx, id)
				if bound.SHA256 != next.SHA256 {
					t.Fatal("instance did not adopt reviewed source")
				}
			} else {
				revised := cloneTemplateSpec(*preview.Template.Spec)
				revised.Endpoint.StartupTimeout = 20
				if _, err := m.UpdateTemplate(ctx, preview.Template.TemplateID, TemplateWriteRequest{RequestID: "native-after-stop-edit", Name: "My restarted service", Spec: revised}); err != nil {
					t.Fatal(err)
				}
			}

			op, err = m.Operate(ctx, id, OperationRequest{RequestID: "market-native-start", Action: ActionStart})
			if err != nil {
				t.Fatal(err)
			}
			dockerLifecycleOperation(t, ctx, m, op)
			service = dockerLifecycleService(t, ctx, m, id)
			if err = m.waitHealthy(ctx, service); err != nil {
				t.Fatal(err)
			}
			resolved, err := m.resolveCurrentRuntime(ctx, service)
			if err != nil || !resolved.MatchesApplied {
				t.Fatal("native runtime lost reviewed digest", err)
			}
			response, err := (&http.Client{Timeout: 5 * time.Second}).Get(fmt.Sprintf("http://127.0.0.1:%d/", service.RuntimePort))
			if err != nil {
				t.Fatal(err)
			}
			io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("open status=%d", response.StatusCode)
			}
			if personal {
				if dir := os.Getenv("REDEVEN_PERSONAL_TEMPLATE_EVIDENCE"); dir != "" {
					input, _ := json.Marshal(map[string]any{"url": fmt.Sprintf("http://127.0.0.1:%d/", service.RuntimePort), "screenshot": filepath.Join(dir, string(kind)+"-app.png")})
					command := exec.CommandContext(ctx, "node", "../envapp/ui_src/scripts/checkOfficialTemplatePage.mjs")
					command.Stdin = strings.NewReader(string(input))
					output, err := command.CombinedOutput()
					if err != nil {
						t.Fatalf("browser acceptance: %v %s", err, output)
					}
					t.Logf("browser %s: %s", kind, output)
				}
			}
		})
	}
}
func TestMarketHTTPHelper(t *testing.T) {
	if os.Getenv("REDEVEN_MARKET_HTTP_HELPER") != "1" {
		return
	}
	if err := http.ListenAndServe("127.0.0.1:"+os.Getenv("REDEVEN_SERVICE_PORT"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<html><body>Market service ready</body></html>")
	})); err != nil {
		t.Fatal(err)
	}
}
