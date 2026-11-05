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
)

// Only the loopback authenticated carrier is a fixture. The author/formal Host,
// product surface components, released SDK and generated application are real.
func qualifyGeneratedAuthorBrowser(t *testing.T, ctx context.Context, integration *Integration, meta *session.Meta, workspace, instance string, formal bool, reports string) {
	t.Helper()
	repo, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dist := filepath.Join(reports, "browser-dist")
	if _, err := os.Stat(filepath.Join(dist, "index.html")); os.IsNotExist(err) {
		command := exec.CommandContext(ctx, "node", "scripts/check_plugin_author_browser.mjs", "--build", dist)
		command.Dir = repo
		if out, err := command.CombinedOutput(); err != nil {
			t.Fatalf("build author browser: %v\n%s", err, out)
		}
	}
	authorCtx, owner, err := integration.author.context(ctx, meta)
	if err != nil {
		t.Fatal(err)
	}
	h := integration.host
	if !formal {
		env, err := integration.author.environment(authorCtx, owner, workspace, meta)
		if err != nil {
			t.Fatal(err)
		}
		h = env.Host()
	}
	records, err := h.ListPlugins(authorCtx)
	if err != nil {
		t.Fatal(err)
	}
	var target map[string]any
	for _, record := range records {
		if record.PluginInstanceID != instance {
			continue
		}
		for _, surface := range record.Manifest.Surfaces {
			if surface.Kind == "view" {
				target = map[string]any{"pluginID": record.PluginID, "pluginInstanceID": instance, "surfaceID": surface.SurfaceID, "displayName": record.Manifest.Plugin.DisplayName, "expectedManagementRevision": record.ManagementRevision}
				break
			}
		}
	}
	if target == nil {
		t.Fatal("generated application has no view")
	}
	var parent string
	productOwner, err := plugincreation.OwnerFromSession(meta)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := integration.author.drafts.Store.ForWorkspace(ctx, productOwner, workspace)
	if err != nil {
		t.Fatal(err)
	}
	assets := http.FileServer(http.Dir(dist))
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
			cookie, e := r.Cookie("author-qualification")
			if e != nil || cookie.Value != "authenticated" {
				http.Error(w, "session required", 401)
				return
			}
			bound.Header.Set(sessionhop.HeaderChannelID, meta.ChannelID)
			integration.Handler().ServeHTTP(w, WithRouteRole(bound, RouteRoleEnvTrusted))
			return
		}
		// Only the read-only product draft carrier is supplied by the fixture.
		// Mutations and exact-byte installation run through real product routes.
		if r.URL.Path == "/_redeven_proxy/api/plugin-creation/drafts/"+draft.ID && r.Method == http.MethodGet {
			current, failure := integration.author.drafts.Store.Get(r.Context(), productOwner, draft.ID)
			authorJSON(w, current, failure)
			return
		}
		if r.URL.Path == "/qualification.json" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"draftID": draft.ID, "workspaceID": workspace, "formal": formal, "target": target})
			return
		}
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: "author-qualification", Value: "authenticated", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		}
		assets.ServeHTTP(w, r)
	}))
	defer server.Close()
	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	parent = u.Scheme + "://" + u.Host
	name := "preview-browser.json"
	if formal {
		name = "installed-browser.json"
	}
	command := exec.CommandContext(ctx, "node", "scripts/check_plugin_author_browser.mjs", "--run", parent, filepath.Join(reports, name))
	command.Dir = repo
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("generated application browser: %v\n%s", err, out)
	}
}
