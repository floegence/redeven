package redevpluginintegration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/pluginorigin"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/authoring"
)

// The loopback session carrier and authored application are fixtures. Package
// capture, persistence, HTTP adapter, product workspace and browser sandbox are real.
func TestAuthorPreviewVersionBrowser(t *testing.T) {
	if os.Getenv("REDEVEN_PLUGIN_PREVIEW_VERSION_BROWSER") != "1" {
		t.Skip("explicit browser qualification")
	}
	ctx := t.Context()
	root := t.TempDir()
	reports := os.Getenv("REDEVEN_PLUGIN_PREVIEW_VERSION_REPORT_DIR")
	if reports == "" {
		reports = filepath.Join(root, "evidence")
	}
	if err := os.MkdirAll(reports, 0700); err != nil {
		t.Fatal(err)
	}
	store, err := plugincreation.Open(filepath.Join(root, "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := plugincreation.New(store)
	meta := &session.Meta{ChannelID: "revision-channel", EndpointID: "revision-environment", UserPublicID: "revision-user", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	options := ownerScopeTestOptions(t, root)
	if runtime := os.Getenv("REDEVEN_TEST_PLUGIN_RUNTIME"); runtime != "" {
		options.RuntimePath = runtime
	}
	options.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	options.PluginCreation = service
	options.ResolveSessionMeta = func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }
	integration, err := New(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := integration.Close(); err != nil {
			t.Error(err)
		}
	}()
	draft, err := service.Create(ctx, meta, "preview-revisions")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := integration.author.AuthorOperation(ctx, meta, draft.WorkspaceID, "initialize", map[string]any{"slug": "revision-notes", "display_name": "Revision notes", "template": "web"}); err != nil {
		t.Fatal(err)
	}
	authorCtx, owner, err := integration.author.context(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := integration.author.store.Get(authorCtx, owner, draft.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	capture := func(version, title string) (authoring.Artifact, error) {
		for _, directory := range []string{workspace.SourceDirectory, filepath.Join(workspace.SourceDirectory, "dist")} {
			manifestPath := filepath.Join(directory, "manifest.json")
			raw, err := os.ReadFile(manifestPath)
			if err != nil {
				return authoring.Artifact{}, err
			}
			var document map[string]any
			if err := json.Unmarshal(raw, &document); err != nil {
				return authoring.Artifact{}, err
			}
			document["plugin"].(map[string]any)["version"] = version
			raw, _ = json.Marshal(document)
			if err := os.WriteFile(manifestPath, raw, 0600); err != nil {
				return authoring.Artifact{}, err
			}
			if err := os.MkdirAll(filepath.Join(directory, "ui/assets"), 0700); err != nil {
				return authoring.Artifact{}, err
			}
			html := `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./assets/styles.css"></head><body><main><p>REVISION NOTES</p><h1>` + title + `</h1><p>A saved view of your evolving application.</p><button type="button">Count 0</button><script type="module" src="./assets/app.js"></script></main></body></html>`
			if err := os.WriteFile(filepath.Join(directory, "ui/index.html"), []byte(html), 0600); err != nil {
				return authoring.Artifact{}, err
			}
			if err := os.WriteFile(filepath.Join(directory, "ui/assets/app.js"), []byte(`let count=0;document.querySelector('button').onclick=event=>event.target.textContent='Count '+(++count);`), 0600); err != nil {
				return authoring.Artifact{}, err
			}
			css := `body{margin:0;font:13px system-ui;background:#faf9f6;color:#282723}main{padding:64px 8%;max-width:680px}h1{font-size:32px;font-weight:500;letter-spacing:-1px}p{color:#6d6a63;line-height:1.6}button{border:0;border-radius:6px;padding:9px 14px;background:#292823;color:#fff;font:inherit;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#20201e;color:#eeede7}p{color:#a5a39a}button{background:#eeede7;color:#24241f}}`
			if err := os.WriteFile(filepath.Join(directory, "ui/assets/styles.css"), []byte(css), 0600); err != nil {
				return authoring.Artifact{}, err
			}
		}
		return integration.author.store.Capture(authorCtx, owner, draft.WorkspaceID)
	}
	first, err := capture("1.0.0", "First revision")
	if err != nil {
		t.Fatal(err)
	}
	productOwner, err := plugincreation.OwnerFromSession(meta)
	if err != nil {
		t.Fatal(err)
	}
	repo, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dist := filepath.Join(reports, "browser-dist")
	build := exec.CommandContext(ctx, "node", "scripts/check_plugin_author_browser.mjs", "--build", dist)
	build.Dir = repo
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build preview carrier: %v\n%s", err, out)
	}
	var parent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := "http://" + r.Host
		bound, failure := WithTrustedOrigin(r, origin)
		if failure != nil {
			http.NotFound(w, r)
			return
		}
		if origin != parent {
			if !pluginorigin.IsChild(parent, origin) {
				http.NotFound(w, r)
				return
			}
			integration.WebSurfaceHandler().ServeHTTP(w, bound)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/_redevplugin/") {
			bound.Header.Set(sessionhop.HeaderChannelID, meta.ChannelID)
			integration.Handler().ServeHTTP(w, WithRouteRole(bound, RouteRoleEnvTrusted))
			return
		}
		switch r.URL.Path {
		case "/qualification.json":
			_ = json.NewEncoder(w).Encode(map[string]any{"draftID": draft.ID, "workspaceID": draft.WorkspaceID, "firstArtifact": first.ID, "history": true})
		case "/qualification/build":
			if r.Method != http.MethodPost {
				w.WriteHeader(405)
				return
			}
			var request struct {
				Version string `json:"version"`
				Title   string `json:"title"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				authorJSON(w, nil, err)
				return
			}
			artifact, err := capture(request.Version, request.Title)
			authorJSON(w, artifact, err)
		case "/_redeven_proxy/api/plugin-creation/drafts/" + draft.ID:
			current, err := store.Get(r.Context(), productOwner, draft.ID)
			authorJSON(w, current, err)
		case "/":
			http.FileServer(http.Dir(dist)).ServeHTTP(w, r)
		default:
			http.FileServer(http.Dir(dist)).ServeHTTP(w, r)
		}
	}))
	defer server.Close()
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	parent = parsed.Scheme + "://" + parsed.Host
	command := exec.CommandContext(ctx, "node", "scripts/check_plugin_preview_versions.mjs", parent, filepath.Join(reports, "report.json"))
	command.Dir = repo
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("preview version browser: %v\n%s", err, out)
	}
	// Selection is visual review, not a source rollback or a formal installation.
	if _, err := integration.author.store.Get(context.WithoutCancel(ctx), owner, draft.WorkspaceID); err != nil {
		t.Fatal(err)
	}
}
