package gateway

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestGateway_AISkills_CRUDAndToggle(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	workspace := t.TempDir()
	skillName := "gateway-skill"
	skillDir := filepath.Join(workspace, ".redeven", "skills", skillName)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	skillContent := `---
name: gateway-skill
description: test skill
---

# gateway skill`
	if err := os.WriteFile(skillPath, []byte(skillContent), 0o600); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	aiSvc, err := ai.NewService(ai.Options{
		Logger:   logger,
		StateDir: stateDir,
		FSRoot:   workspace,
		Shell:    "bash",
		Config: &config.AIConfig{Providers: []config.AIProvider{{
			ID:      "openai",
			Name:    "OpenAI",
			Type:    "openai",
			BaseURL: "https://api.openai.com/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
		}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_skills_1"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Logger:             logger,
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
		AI:                 aiSvc,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	decodeSkills := func(body []byte) map[string]any {
		t.Helper()
		var resp map[string]any
		if err := json.Unmarshal(body, &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		data, _ := resp["data"].(map[string]any)
		return data
	}

	// list
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/skills", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("skills list status=%d body=%s", rr.Code, rr.Body.String())
		}
		data := decodeSkills(rr.Body.Bytes())
		skills, _ := data["skills"].([]any)
		if len(skills) == 0 {
			t.Fatalf("expected non-empty skills catalog")
		}
	}

	// toggle disabled
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/skills/toggles", bytes.NewBufferString(`{"patches":[{"path":"`+skillPath+`","enabled":false}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("skills toggle status=%d body=%s", rr.Code, rr.Body.String())
		}
		data := decodeSkills(rr.Body.Bytes())
		skills, _ := data["skills"].([]any)
		foundDisabled := false
		for _, raw := range skills {
			item, _ := raw.(map[string]any)
			if strings.TrimSpace(anyToString(item["path"])) == skillPath {
				if item["enabled"] == false {
					foundDisabled = true
				}
			}
		}
		if !foundDisabled {
			t.Fatalf("expected toggled skill to be disabled")
		}
	}

	// create skill
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/skills", bytes.NewBufferString(`{"scope":"workspace","name":"created-skill","description":"created from test"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("skills create status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	// delete created skill
	{
		req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/ai/skills", bytes.NewBufferString(`{"scope":"workspace","name":"created-skill"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("skills delete status=%d body=%s", rr.Code, rr.Body.String())
		}
	}
}

func TestGateway_AISkills_PermissionModel(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	workspace := t.TempDir()
	skillDir := filepath.Join(workspace, ".redeven", "skills", "perm-skill")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: perm-skill\ndescription: test\n---\n\nbody"), 0o600); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	aiSvc, err := ai.NewService(ai.Options{
		Logger:   logger,
		StateDir: stateDir,
		FSRoot:   workspace,
		Shell:    "bash",
		Config: &config.AIConfig{Providers: []config.AIProvider{{
			ID:      "openai",
			Name:    "OpenAI",
			Type:    "openai",
			BaseURL: "https://api.openai.com/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
		}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_skills_perm_1"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Logger:             logger,
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: false}),
		AI:                 aiSvc,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/skills", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("skills list should allow read permission, got=%d body=%s", rr.Code, rr.Body.String())
		}
	}
	{
		req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/ai/skills/toggles", bytes.NewBufferString(`{"patches":[{"path":"/tmp/not-used","enabled":false}]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("skills toggle should require admin, got=%d body=%s", rr.Code, rr.Body.String())
		}
	}
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/skills/import/github", bytes.NewBufferString(`{"scope":"workspace","repo":"openai/skills","ref":"main","paths":["skills/.curated/skill-installer"]}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("skills github import should require admin, got=%d body=%s", rr.Code, rr.Body.String())
		}
	}
}

func TestGateway_AISkills_GitHubImportAndBrowse(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	workspace := t.TempDir()

	zipBuf := &bytes.Buffer{}
	zw := zip.NewWriter(zipBuf)
	md := `---
name: skill-installer
description: Install Codex skills
---

# Skill Installer`
	f, err := zw.Create("openai-skills-main/skills/.curated/skill-installer/SKILL.md")
	if err != nil {
		t.Fatalf("create zip entry: %v", err)
	}
	if _, err := f.Write([]byte(md)); err != nil {
		t.Fatalf("write zip entry: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}

	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/repos/openai/skills/contents/skills/.curated"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"name":"skill-installer","path":"skills/.curated/skill-installer","type":"dir"}]`))
			return
		case r.URL.Path == "/raw/openai/skills/main/skills/.curated/skill-installer/SKILL.md":
			_, _ = w.Write([]byte(md))
			return
		case r.URL.Path == "/repos/openai/skills/zipball/main":
			_, _ = w.Write(zipBuf.Bytes())
			return
		default:
			http.NotFound(w, r)
			return
		}
	}))
	defer gh.Close()

	t.Setenv("REDEVEN_AGENT_AI_SKILLS_GITHUB_API_BASE_URL", gh.URL)
	t.Setenv("REDEVEN_AGENT_AI_SKILLS_GITHUB_RAW_BASE_URL", gh.URL+"/raw")
	t.Setenv("REDEVEN_AGENT_AI_SKILLS_GITHUB_REPO_BASE_URL", gh.URL)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	aiSvc, err := ai.NewService(ai.Options{
		Logger:   logger,
		StateDir: stateDir,
		FSRoot:   workspace,
		Shell:    "bash",
		Config: &config.AIConfig{Providers: []config.AIProvider{{
			ID:      "openai",
			Name:    "OpenAI",
			Type:    "openai",
			BaseURL: "https://api.openai.com/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
		}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	cfgPath := writeTestConfigWithAI(t)
	channelID := "ch_skills_github_1"
	envOrigin := envOriginWithChannel(channelID)
	gw, err := New(Options{
		Logger:             logger,
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
		AI:                 aiSvc,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	request := func(method string, path string, body string) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Origin", envOrigin)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("%s %s failed status=%d body=%s", method, path, rr.Code, rr.Body.String())
		}
		var payload map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		data, _ := payload["data"].(map[string]any)
		return data
	}

	validateData := request(http.MethodPost, "/_redeven_proxy/api/ai/skills/import/github/validate", `{"scope":"workspace","repo":"openai/skills","ref":"main","paths":["skills/.curated/skill-installer"]}`)
	resolved, _ := validateData["resolved"].([]any)
	if len(resolved) != 1 {
		t.Fatalf("expected one resolved item, got=%d", len(resolved))
	}

	importData := request(http.MethodPost, "/_redeven_proxy/api/ai/skills/import/github", `{"scope":"workspace","repo":"openai/skills","ref":"main","paths":["skills/.curated/skill-installer"]}`)
	imports, _ := importData["imports"].([]any)
	if len(imports) != 1 {
		t.Fatalf("expected one imported item, got=%d", len(imports))
	}
	firstImport, _ := imports[0].(map[string]any)
	skillPath := strings.TrimSpace(anyToString(firstImport["skill_path"]))
	if skillPath == "" {
		t.Fatalf("missing imported skill path")
	}

	sourcesData := request(http.MethodGet, "/_redeven_proxy/api/ai/skills/sources", "")
	sourceItems, _ := sourcesData["items"].([]any)
	if len(sourceItems) == 0 {
		t.Fatalf("expected sources items")
	}

	treePath := "/_redeven_proxy/api/ai/skills/browse/tree?skill_path=" + url.QueryEscape(skillPath) + "&dir=."
	treeData := request(http.MethodGet, treePath, "")
	treeEntries, _ := treeData["entries"].([]any)
	if len(treeEntries) == 0 {
		t.Fatalf("expected browse tree entries")
	}

	filePath := "/_redeven_proxy/api/ai/skills/browse/file?skill_path=" + url.QueryEscape(skillPath) + "&file=SKILL.md&encoding=utf8&max_bytes=1024"
	fileData := request(http.MethodGet, filePath, "")
	content := anyToString(fileData["content"])
	if !strings.Contains(content, "Install Codex skills") {
		t.Fatalf("unexpected browse file content: %q", content)
	}

	reinstallBody := `{"paths":["` + skillPath + `"],"overwrite":true}`
	reinstallData := request(http.MethodPost, "/_redeven_proxy/api/ai/skills/reinstall", reinstallBody)
	reinstalled, _ := reinstallData["reinstalled"].([]any)
	if len(reinstalled) != 1 {
		t.Fatalf("expected one reinstalled item, got=%d", len(reinstalled))
	}
}

func anyToString(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}
