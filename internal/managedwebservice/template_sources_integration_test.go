package managedwebservice

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type templateSourceTransport func(*http.Request) (*http.Response, error)

func (f templateSourceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSourceModesPreserveHistoricalBytesAcrossRestart(t *testing.T) {
	ctx := context.Background()
	raw, err := os.ReadFile("testdata/github-source-transfer.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture templatecontract.Snapshot
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	blobs := map[string]templatecontract.File{}
	tree := []map[string]any{}
	for _, file := range fixture.Files {
		digest := sha1.Sum(append([]byte(fmt.Sprintf("blob %d\x00", len(file.Content))), file.Content...))
		sha := fmt.Sprintf("%x", digest)
		blobs[sha] = file
		tree = append(tree, map[string]any{"path": file.Path, "mode": file.Mode, "type": "blob", "sha": sha, "size": len(file.Content)})
	}
	client := &http.Client{Transport: templateSourceTransport(func(req *http.Request) (*http.Response, error) {
		if req.URL.Scheme != "https" || req.URL.Host != "api.github.com" || req.Header.Get("Authorization") != "Bearer temporary-source-token" {
			t.Fatal("credential escaped authenticated API acquisition")
		}
		var body any
		switch {
		case req.URL.Path == "/repos/example/templates":
			body = map[string]any{"id": 123, "full_name": "example/templates", "default_branch": "develop"}
		case req.URL.Path == "/repos/example/templates/commits/develop":
			body = map[string]any{"sha": fixture.Source.CommitSHA, "commit": map[string]any{"tree": map[string]any{"sha": fixture.Source.TreeSHA}}}
		case req.URL.Path == "/repos/example/templates/git/trees/"+fixture.Source.TreeSHA:
			body = map[string]any{"sha": fixture.Source.TreeSHA, "tree": tree, "truncated": false}
		case strings.HasPrefix(req.URL.Path, "/repos/example/templates/git/blobs/"):
			sha := strings.TrimPrefix(req.URL.Path, "/repos/example/templates/git/blobs/")
			file, ok := blobs[sha]
			if !ok {
				t.Fatal("unexpected blob")
			}
			body = map[string]any{"sha": sha, "size": len(file.Content), "encoding": "base64", "content": base64.StdEncoding.EncodeToString(file.Content)}
		default:
			t.Fatal("unexpected network request", req.URL.Path)
		}
		encoded, _ := json.Marshal(body)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(encoded)))}, nil
	})}
	t.Setenv("PATH", t.TempDir())
	for _, mode := range []string{"desktop_transfer", "remote_download"} {
		t.Run(mode, func(t *testing.T) {
			scope, state := newManagedServiceTestScope(t)
			registryPath := filepath.Join(state, "registry.sqlite")
			registry, err := pfregistry.Open(registryPath)
			if err != nil {
				t.Fatal(err)
			}
			m := &Manager{registry: registry, scope: scope, stateDir: state, templateSourceClient: client}
			req := TemplateSourceInspectRequest{Source: templatecontract.GitSource{Repository: "example/templates"}, Token: "temporary-source-token"}
			if mode == "desktop_transfer" {
				req.Snapshot = &fixture
				req.Token = ""
			}
			preview, err := m.InspectTemplateSource(ctx, "owner", req)
			if err != nil {
				t.Fatal(err)
			}
			if preview.SHA256 != fixture.SHA256 || preview.SourceDocumentVersion != 2 || preview.SourceSpecVersion != 5 || preview.Template.Spec.SchemaVersion != 6 {
				t.Fatal("transfer or compatibility changed source identity")
			}
			if preview.Template.Spec.Host.OpenScript == "" || preview.Template.Spec.Host.AfterStartScript == "" || preview.Template.Spec.Host.OutputMode != "private_file" {
				t.Fatal("historical opening behavior was lost")
			}
			imported, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "source-mode-import", CandidateID: preview.CandidateID, SHA256: preview.SHA256})
			if err != nil {
				t.Fatal(err)
			}
			if err := registry.Close(); err != nil {
				t.Fatal(err)
			}
			registry, err = pfregistry.Open(registryPath)
			if err != nil {
				t.Fatal(err)
			}
			defer registry.Close()
			restarted := &Manager{registry: registry, scope: scope, stateDir: state}
			if err := restarted.cleanupTemplateSourceOrphans(ctx); err != nil {
				t.Fatal(err)
			}
			current, err := restarted.Template(ctx, imported.TemplateID)
			if err != nil {
				t.Fatal(err)
			}
			if current.SourceSHA256 != fixture.SHA256 || current.GitSource.CommitSHA != fixture.Source.CommitSHA {
				t.Fatal("restart changed source provenance")
			}
			for _, file := range fixture.Files {
				saved, err := os.ReadFile(filepath.Join(current.SourceDirectory, file.Path))
				if err != nil || string(saved) != string(file.Content) {
					t.Fatal("historical original was rewritten", file.Path, err)
				}
			}
			if _, err := os.Stat(filepath.Join(current.SourceDirectory, templatecontract.Filename)); !os.IsNotExist(err) {
				t.Fatal("compatibility persisted a new declaration")
			}
			if rows, _ := registry.ListManagedTemplates(ctx); len(rows) != 0 {
				t.Fatal("compatibility persisted a second execution definition")
			}
			if err := filepath.Walk(state, func(path string, info os.FileInfo, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if !info.IsDir() {
					bytes, err := os.ReadFile(path)
					if err != nil {
						return err
					}
					if strings.Contains(string(bytes), "temporary-source-token") {
						t.Fatal("credential persisted", path)
					}
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSourceHostHookReadsOriginalHelperDirectory(t *testing.T) {
	ctx := context.Background()
	m, service := hostTestService(t, t.TempDir(), TemplateSpec{SchemaVersion: 6, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sample"}})
	snapshot := sourceSnapshot(t, "printf helper-used > \"$REDEVEN_WORKSPACE/helper-result\"")
	preview, err := m.InspectTemplateSource(ctx, "owner", TemplateSourceInspectRequest{Snapshot: &snapshot})
	if err != nil {
		t.Fatal(err)
	}
	imported, err := m.ConfirmTemplateSource(ctx, "owner", TemplateSourceConfirmRequest{RequestID: "source-host-helper", CandidateID: preview.CandidateID, SHA256: preview.SHA256})
	if err != nil {
		t.Fatal(err)
	}
	service.TemplateID = imported.TemplateID
	service.RuntimeBindingJSON, service.RuntimeBindingSHA256, err = newRuntimeBinding(service.ServiceID, imported.ServiceFamilyID, DeploymentHost)
	if err != nil {
		t.Fatal(err)
	}
	driver := &hostScriptDriver{manager: m}
	env, err := driver.serviceEnvironment(ctx, service, "")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", `/bin/sh "$REDEVEN_TEMPLATE_DIR/scripts/start.sh"`)
	cmd.Env = env
	cmd.Dir = service.WorkspacePath
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatal(err, string(output))
	}
	result, err := os.ReadFile(filepath.Join(service.WorkspacePath, "helper-result"))
	if err != nil || string(result) != "helper-used" {
		t.Fatal("helper did not run in the authorized workspace", err)
	}
}
