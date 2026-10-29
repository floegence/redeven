package agentplugins

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestCatalogDisplayMetadataIsAdditive(t *testing.T) {
	data := `{"schema_version":"flower.agent_plugin_catalog.v1","id":"community","plugins":[{"id":"review","display":{"name":"Code review","description":"Review changes","author":"Example","future_badge":"not trusted"},"source":{"type":"github","repository":"example/tools","path":"plugins/review","ref":"stable"}}]}`
	catalog, err := DecodeCatalog([]byte(data))
	if err != nil || len(catalog.Plugins) != 1 {
		t.Fatalf("display metadata prevented discovery: %v", err)
	}
	if catalog.Plugins[0].Source.Path != "plugins/review" {
		t.Fatal("package path lost")
	}
	if catalog.Plugins[0].Display.Name != "Code review" {
		t.Fatal("display metadata lost")
	}
	encoded, err := json.Marshal(catalog)
	if err != nil || strings.Contains(string(encoded), "future_badge") {
		t.Fatal("unknown display fields escaped", err)
	}
}

func catalogDocument(entries ...CatalogEntry) []byte {
	data, _ := json.Marshal(Catalog{Schema: "flower.agent_plugin_catalog.v1", ID: "community", Plugins: entries})
	return data
}
func TestCatalogContractRejectsAuthorityChanges(t *testing.T) {
	entry := CatalogEntry{ID: "review", Source: Source{Type: "github", Repository: "example/tools", Ref: "stable"}}
	valid := catalogDocument(entry)
	for _, field := range []string{"command", "enabled", "credentials"} {
		var doc map[string]any
		_ = json.Unmarshal(valid, &doc)
		doc["plugins"].([]any)[0].(map[string]any)["source"].(map[string]any)[field] = "unexpected"
		body, _ := json.Marshal(doc)
		if _, err := DecodeCatalog(body); err == nil {
			t.Fatalf("accepted source field %s", field)
		}
	}
	cases := map[string][]byte{"duplicate": catalogDocument(entry, entry), "trailing": append(valid, []byte("{}")...), "future version": []byte(strings.Replace(string(valid), "catalog.v1", "catalog.v2", 1))}
	many := make([]CatalogEntry, 129)
	cases["too many"] = catalogDocument(many...)
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeCatalog(body); err == nil {
				t.Fatal("accepted invalid catalog")
			}
		})
	}
	entry.Display = &CatalogDisplay{Description: strings.Repeat("x", 513)}
	if _, err := DecodeCatalog(catalogDocument(entry)); err == nil {
		t.Fatal("accepted oversized display")
	}
}

func TestCatalogConfigIsOptionalAndValidated(t *testing.T) {
	for _, input := range []string{"", "  ", "[]"} {
		if sources, err := ParseCatalogConfig(input); err != nil || len(sources) != 0 {
			t.Fatal(sources, err)
		}
	}
	configured := CatalogConfig{ID: "community", Name: "Community", URL: "https://catalog.example.com/plugins.json"}
	for _, input := range []string{"null", "{}", "[] {}"} {
		if _, err := ParseCatalogConfig(input); err == nil {
			t.Fatal("invalid config accepted", input)
		}
	}
	for _, address := range []string{"http://example.com/list", "https:///list", "https://user@example.com/list", "https://example.com/list?token=x", "https://example.com/list#fragment"} {
		invalid := configured
		invalid.URL = address
		if _, err := configuredCatalogSources([]CatalogConfig{invalid}); err == nil {
			t.Fatal("invalid URL accepted", address)
		}
	}
	if _, err := configuredCatalogSources([]CatalogConfig{configured, configured}); err == nil {
		t.Fatal("duplicate config accepted")
	}
}

func TestConfiguredCatalogsNeverPersistOrChangeInstallations(t *testing.T) {
	state := t.TempDir()
	m, err := Open(state)
	if err != nil {
		t.Fatal(err)
	}
	installed := install(t, m, fixture(t))
	body := catalogDocument(CatalogEntry{ID: "review", Source: Source{Type: "github", Repository: "example/tools"}})
	m.http = &http.Client{Transport: updateTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(body))), Header: http.Header{}}, nil
	})}
	_, revision := m.Sources()
	userSource, err := m.AddSource(t.Context(), "https://catalog.example.com/plugins.json", revision)
	if err != nil {
		t.Fatal(err)
	}
	_, revision = m.Sources()
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	config := []CatalogConfig{{ID: "community", Name: "Community", URL: userSource.URL}}
	m, err = OpenWithCatalogs(state, config)
	if err != nil {
		t.Fatal(err)
	}
	m.http = &http.Client{Transport: updateTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })}
	sources, after := m.Sources()
	if len(sources) != 1 || !sources[0].Managed || sources[0].ID != "configured:community" || after != revision || len(m.state.Sources) != 1 || m.state.Sources[0] != userSource {
		t.Fatal(sources, after)
	}
	if err := m.RemoveSource(sources[0].ID, after); err == nil {
		t.Fatal("configured source removed through user mutation")
	}
	if _, err := m.ReadCatalog(t.Context(), sources[0].ID); err == nil {
		t.Fatal("offline catalog reported success")
	}
	if !m.Current(installed.ID, installed.Revision, "skill:review") {
		t.Fatal("catalog failure changed installation authority")
	}
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	m, err = Open(state)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	sources, after = m.Sources()
	if len(sources) != 1 || sources[0] != userSource || after != revision {
		t.Fatal("runtime config overwrote user source", sources, after)
	}
	if !m.Current(installed.ID, installed.Revision, "skill:review") {
		t.Fatal("removing configuration changed installation")
	}
}

func TestCatalogPathsPrepareActualPackageMetadata(t *testing.T) {
	m, err := OpenWithCatalogs(t.TempDir(), []CatalogConfig{{ID: "community", Name: "Community", URL: "https://catalog.example.com/plugins.json"}})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	entries := []CatalogEntry{
		{ID: "review", Display: &CatalogDisplay{Name: "Directory claim"}, Source: Source{Type: "github", Repository: "example/tools", Ref: "stable", Path: "plugins/review"}},
		{ID: "writer", Source: Source{Type: "github", Repository: "example/tools", Ref: "stable", Path: "plugins/writer"}},
	}
	files := map[string]string{}
	for _, entry := range entries {
		manifest, _ := json.Marshal(map[string]string{"$schema": ManifestSchema, "name": entry.ID})
		files["repo-hash/"+entry.Source.Path+"/plugin.json"] = string(manifest)
	}
	github := githubClient(t, files)
	m.http = &http.Client{Transport: updateTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "catalog.example.com" {
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(catalogDocument(entries...))))}, nil
		}
		return github.Transport.RoundTrip(r)
	})}
	catalog, err := m.ReadCatalog(t.Context(), "configured:community")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range catalog.Plugins {
		op, err := m.Prepare(t.Context(), "owner", PrepareRequest{RequestID: entry.ID + "-request", Source: entry.Source})
		if err != nil || op.Status != "ready" || op.Package.Manifest.Name != entry.ID {
			t.Fatal("preview trusted directory display", op, err)
		}
		if _, err := m.Commit("owner", CommitRequest{OperationID: op.ID, Digest: op.Digest}); err != nil {
			t.Fatal(err)
		}
	}
	items, _ := m.List()
	if len(items) != 2 || items[0].Source.Key() == items[1].Source.Key() {
		t.Fatal("package paths collided", items)
	}
}

func TestCatalogRejectsOversizedDocuments(t *testing.T) {
	data := `{"schema_version":"flower.agent_plugin_catalog.v1","id":"community","plugins":[]}` + strings.Repeat(" ", MaxConfigBytes)
	if _, err := DecodeCatalog([]byte(data)); err == nil {
		t.Fatal("oversized catalog accepted")
	}
}
