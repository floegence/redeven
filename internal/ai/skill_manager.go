package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

type SkillMCPDependency struct {
	Name      string `json:"name,omitempty" yaml:"name"`
	Transport string `json:"transport,omitempty" yaml:"transport"`
	Command   string `json:"command,omitempty" yaml:"command"`
	URL       string `json:"url,omitempty" yaml:"url"`
}

type SkillMeta struct {
	Name                    string               `json:"name"`
	Description             string               `json:"description"`
	Path                    string               `json:"path"`
	Scope                   string               `json:"scope"`
	Priority                int                  `json:"priority,omitempty"`
	ModeHints               []string             `json:"mode_hints,omitempty"`
	AllowImplicitInvocation bool                 `json:"allow_implicit_invocation"`
	Dependencies            []SkillMCPDependency `json:"dependencies,omitempty"`
}

type SkillActivation struct {
	ActivationID string               `json:"activation_id"`
	Name         string               `json:"name"`
	RootDir      string               `json:"root_dir"`
	Priority     int                  `json:"priority"`
	Content      string               `json:"content"`
	ContentRef   string               `json:"content_ref"`
	ModeHints    []string             `json:"mode_hints,omitempty"`
	Dependencies []SkillMCPDependency `json:"dependencies,omitempty"`
	ActivatedAt  int64                `json:"activated_at_unix_ms"`
}

type SkillCatalog struct {
	CatalogVersion int64                `json:"catalog_version"`
	Skills         []SkillCatalogEntry  `json:"skills"`
	Conflicts      []SkillCatalogNotice `json:"conflicts,omitempty"`
	Errors         []SkillCatalogNotice `json:"errors,omitempty"`
}

type SkillCatalogEntry struct {
	ID                      string               `json:"id"`
	Name                    string               `json:"name"`
	Description             string               `json:"description"`
	Path                    string               `json:"path"`
	Scope                   string               `json:"scope"`
	Priority                int                  `json:"priority,omitempty"`
	ModeHints               []string             `json:"mode_hints,omitempty"`
	AllowImplicitInvocation bool                 `json:"allow_implicit_invocation"`
	Dependencies            []SkillMCPDependency `json:"dependencies,omitempty"`
	DependencyState         string               `json:"dependency_state,omitempty"`
	Enabled                 bool                 `json:"enabled"`
	Effective               bool                 `json:"effective"`
	ShadowedBy              string               `json:"shadowed_by,omitempty"`
}

type SkillCatalogNotice struct {
	Name       string `json:"name,omitempty"`
	Path       string `json:"path,omitempty"`
	Message    string `json:"message,omitempty"`
	WinnerPath string `json:"winner_path,omitempty"`
}

type SkillTogglePatch struct {
	Path    string `json:"path"`
	Enabled bool   `json:"enabled"`
}

type skillDiscoveryRoot struct {
	Path  string
	Scope string
}

type skillFrontmatter struct {
	Name        string   `yaml:"name"`
	Description string   `yaml:"description"`
	Priority    int      `yaml:"priority"`
	ModeHint    []string `yaml:"mode_hint"`
	Policy      struct {
		AllowImplicitInvocation *bool `yaml:"allow_implicit_invocation"`
	} `yaml:"policy"`
	Dependencies struct {
		MCPServers []SkillMCPDependency `yaml:"mcp_servers"`
	} `yaml:"dependencies"`
}

type skillStateFile struct {
	SchemaVersion int      `json:"schema_version"`
	DisabledPaths []string `json:"disabled_paths,omitempty"`
}

type skillManager struct {
	mu               sync.RWMutex
	workspace        string
	userHome         string
	statePath        string
	sourcePath       string
	discovered       map[string]SkillMeta
	candidatesByName map[string][]SkillMeta
	active           map[string]SkillActivation

	disabledPaths map[string]struct{}
	stateLoaded   bool
	sources       map[string]SkillSourceRecord
	sourcesLoaded bool

	catalogVersion  int64
	catalogEntries  []SkillCatalogEntry
	catalogConflict []SkillCatalogNotice
	catalogErrors   []SkillCatalogNotice

	githubAPIBaseURL  string
	githubRawBaseURL  string
	githubRepoBaseURL string
	httpClient        *http.Client
}

var skillNameRE = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func newSkillManager(workspace string, stateDir string) *skillManager {
	home, _ := os.UserHomeDir()
	path := ""
	sourcePath := ""
	stateDir = strings.TrimSpace(stateDir)
	if stateDir != "" {
		path = filepath.Join(stateDir, "skills_state.json")
		sourcePath = filepath.Join(stateDir, "skills_sources.json")
	}
	if path != "" {
		path = filepath.Clean(path)
	}
	if sourcePath != "" {
		sourcePath = filepath.Clean(sourcePath)
	}
	return &skillManager{
		workspace:        strings.TrimSpace(workspace),
		userHome:         strings.TrimSpace(home),
		statePath:        path,
		sourcePath:       sourcePath,
		discovered:       map[string]SkillMeta{},
		candidatesByName: map[string][]SkillMeta{},
		active:           map[string]SkillActivation{},
		disabledPaths:    map[string]struct{}{},
		sources:          map[string]SkillSourceRecord{},
		githubAPIBaseURL: firstNonEmpty(
			strings.TrimSpace(os.Getenv("REDEVEN_AGENT_AI_SKILLS_GITHUB_API_BASE_URL")),
			"https://api.github.com",
		),
		githubRawBaseURL: firstNonEmpty(
			strings.TrimSpace(os.Getenv("REDEVEN_AGENT_AI_SKILLS_GITHUB_RAW_BASE_URL")),
			"https://raw.githubusercontent.com",
		),
		githubRepoBaseURL: firstNonEmpty(
			strings.TrimSpace(os.Getenv("REDEVEN_AGENT_AI_SKILLS_GITHUB_REPO_BASE_URL")),
			"https://github.com",
		),
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

func (m *skillManager) roots() []skillDiscoveryRoot {
	roots := make([]skillDiscoveryRoot, 0, 2)
	if home := strings.TrimSpace(m.userHome); home != "" {
		roots = append(roots,
			skillDiscoveryRoot{Path: filepath.Join(home, ".redeven", "skills"), Scope: "user"},
			skillDiscoveryRoot{Path: filepath.Join(home, ".agents", "skills"), Scope: "user_agents"},
		)
	}
	return roots
}

func (m *skillManager) Discover() {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()
}

func (m *skillManager) Reload() SkillCatalog {
	if m == nil {
		return SkillCatalog{}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()
	return m.catalogLocked()
}

func (m *skillManager) Catalog() SkillCatalog {
	if m == nil {
		return SkillCatalog{}
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.catalogLocked()
}

func (m *skillManager) PatchToggles(patches []SkillTogglePatch) (SkillCatalog, error) {
	if m == nil {
		return SkillCatalog{}, fmt.Errorf("nil skill manager")
	}
	if len(patches) == 0 {
		return SkillCatalog{}, fmt.Errorf("missing patches")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	for i := range patches {
		path := filepath.Clean(strings.TrimSpace(patches[i].Path))
		if path == "" {
			return SkillCatalog{}, fmt.Errorf("invalid skill path")
		}
		if !m.hasCatalogPathLocked(path) {
			return SkillCatalog{}, fmt.Errorf("unknown skill path: %s", path)
		}
		if patches[i].Enabled {
			delete(m.disabledPaths, path)
		} else {
			m.disabledPaths[path] = struct{}{}
		}
	}
	if err := m.saveStateLocked(); err != nil {
		return SkillCatalog{}, err
	}
	m.discoverLocked()
	return m.catalogLocked(), nil
}

func (m *skillManager) Create(scope string, name string, description string, body string) (SkillCatalog, error) {
	if m == nil {
		return SkillCatalog{}, fmt.Errorf("nil skill manager")
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	skillRoot, err := m.scopeRootLocked(scope)
	if err != nil {
		return SkillCatalog{}, err
	}
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if !skillNameRE.MatchString(name) {
		return SkillCatalog{}, fmt.Errorf("invalid skill name: %s", name)
	}
	if description == "" {
		return SkillCatalog{}, fmt.Errorf("missing description")
	}
	description = strings.ReplaceAll(description, "\n", " ")
	description = strings.ReplaceAll(description, "\r", " ")
	description = strings.TrimSpace(description)

	skillDir := filepath.Join(skillRoot, name)
	skillFile := filepath.Join(skillDir, "SKILL.md")
	if _, err := os.Stat(skillFile); err == nil {
		return SkillCatalog{}, fmt.Errorf("skill already exists: %s", name)
	}
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		return SkillCatalog{}, err
	}

	body = strings.TrimSpace(body)
	if body == "" {
		body = fmt.Sprintf("# %s\n\nAdd instructions for this skill.", name)
	}
	content := fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s\n", name, description, body)
	if err := os.WriteFile(skillFile, []byte(content), 0o600); err != nil {
		return SkillCatalog{}, err
	}
	now := time.Now().UnixMilli()
	m.sources[filepath.Clean(skillFile)] = SkillSourceRecord{
		SkillPath:           filepath.Clean(skillFile),
		SourceType:          SkillSourceTypeLocalManual,
		SourceID:            "local:" + scope + ":" + name,
		InstalledAtUnixMs:   now,
		LastCheckedAtUnixMs: now,
	}
	if err := m.saveSourcesLocked(); err != nil {
		return SkillCatalog{}, err
	}

	m.discoverLocked()
	return m.catalogLocked(), nil
}

func (m *skillManager) Delete(scope string, name string) (SkillCatalog, error) {
	if m == nil {
		return SkillCatalog{}, fmt.Errorf("nil skill manager")
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	skillRoot, err := m.scopeRootLocked(scope)
	if err != nil {
		return SkillCatalog{}, err
	}
	name = strings.TrimSpace(name)
	if !skillNameRE.MatchString(name) {
		return SkillCatalog{}, fmt.Errorf("invalid skill name: %s", name)
	}
	skillDir := filepath.Join(skillRoot, name)
	skillFile := filepath.Join(skillDir, "SKILL.md")
	if _, err := os.Stat(skillFile); err != nil {
		if os.IsNotExist(err) {
			return SkillCatalog{}, fmt.Errorf("skill not found: %s", name)
		}
		return SkillCatalog{}, err
	}
	if err := os.RemoveAll(skillDir); err != nil {
		return SkillCatalog{}, err
	}
	delete(m.disabledPaths, filepath.Clean(skillFile))
	delete(m.sources, filepath.Clean(skillFile))
	if err := m.saveStateLocked(); err != nil {
		return SkillCatalog{}, err
	}
	if err := m.saveSourcesLocked(); err != nil {
		return SkillCatalog{}, err
	}
	m.discoverLocked()
	return m.catalogLocked(), nil
}

func (m *skillManager) scopeRootLocked(scope string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(scope)) {
	case "user":
		if strings.TrimSpace(m.userHome) == "" {
			return "", fmt.Errorf("user scope unavailable")
		}
		return filepath.Join(m.userHome, ".redeven", "skills"), nil
	case "user_agents":
		if strings.TrimSpace(m.userHome) == "" {
			return "", fmt.Errorf("user scope unavailable")
		}
		return filepath.Join(m.userHome, ".agents", "skills"), nil
	default:
		return "", fmt.Errorf("invalid scope: %s", scope)
	}
}

func (m *skillManager) discoverLocked() {
	if m == nil {
		return
	}
	allErrors := make([]SkillCatalogNotice, 0, 8)
	if err := m.loadStateLocked(); err != nil {
		allErrors = append(allErrors, SkillCatalogNotice{Path: m.statePath, Message: err.Error()})
	}
	if err := m.loadSourcesLocked(); err != nil {
		allErrors = append(allErrors, SkillCatalogNotice{Path: m.sourcePath, Message: err.Error()})
	}

	grouped := make(map[string][]SkillMeta)
	for _, root := range m.roots() {
		skills, errors := scanSkillRoot(root)
		allErrors = append(allErrors, errors...)
		for i := range skills {
			meta := skills[i]
			grouped[meta.Name] = append(grouped[meta.Name], meta)
		}
	}

	effectiveByName := make(map[string]SkillMeta)
	entries := make([]SkillCatalogEntry, 0, len(grouped))
	conflicts := make([]SkillCatalogNotice, 0)
	for _, name := range sortedSkillNames(grouped) {
		items := grouped[name]
		if len(items) == 0 {
			continue
		}
		effectiveIndex := -1
		for i := range items {
			if !m.isDisabledLocked(items[i].Path) {
				effectiveIndex = i
				break
			}
		}
		if effectiveIndex >= 0 {
			effectiveByName[name] = items[effectiveIndex]
		}
		if len(items) > 1 {
			for i := 1; i < len(items); i++ {
				conflicts = append(conflicts, SkillCatalogNotice{
					Name:       name,
					Path:       items[i].Path,
					WinnerPath: items[0].Path,
					Message:    "shadowed by higher-precedence skill",
				})
			}
		}

		winnerPath := ""
		if effectiveIndex >= 0 {
			winnerPath = items[effectiveIndex].Path
		}
		for i := range items {
			item := items[i]
			enabled := !m.isDisabledLocked(item.Path)
			effective := i == effectiveIndex
			shadowedBy := ""
			if i != effectiveIndex && winnerPath != "" {
				shadowedBy = winnerPath
			}
			dependencyState := "ok"
			if len(item.Dependencies) > 0 {
				dependencyState = "degraded"
			}
			entries = append(entries, SkillCatalogEntry{
				ID:                      skillID(item.Scope, item.Path),
				Name:                    item.Name,
				Description:             item.Description,
				Path:                    item.Path,
				Scope:                   item.Scope,
				Priority:                item.Priority,
				ModeHints:               append([]string(nil), item.ModeHints...),
				AllowImplicitInvocation: item.AllowImplicitInvocation,
				Dependencies:            append([]SkillMCPDependency(nil), item.Dependencies...),
				DependencyState:         dependencyState,
				Enabled:                 enabled,
				Effective:               effective,
				ShadowedBy:              shadowedBy,
			})
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Effective != entries[j].Effective {
			return entries[i].Effective
		}
		if entries[i].Priority == entries[j].Priority {
			if entries[i].Name == entries[j].Name {
				return entries[i].Path < entries[j].Path
			}
			return entries[i].Name < entries[j].Name
		}
		return entries[i].Priority > entries[j].Priority
	})
	sort.Slice(conflicts, func(i, j int) bool {
		if conflicts[i].Name == conflicts[j].Name {
			return conflicts[i].Path < conflicts[j].Path
		}
		return conflicts[i].Name < conflicts[j].Name
	})
	sort.Slice(allErrors, func(i, j int) bool {
		if allErrors[i].Path == allErrors[j].Path {
			return allErrors[i].Message < allErrors[j].Message
		}
		return allErrors[i].Path < allErrors[j].Path
	})

	for name := range m.active {
		if _, ok := m.resolveCandidateLocked(name, "", false); !ok {
			delete(m.active, name)
		}
	}

	m.discovered = effectiveByName
	m.candidatesByName = grouped
	m.catalogEntries = entries
	m.catalogConflict = conflicts
	m.catalogErrors = allErrors
	m.pruneSourcesLocked()
	m.catalogVersion++
}

func scanSkillRoot(root skillDiscoveryRoot) ([]SkillMeta, []SkillCatalogNotice) {
	rootPath := filepath.Clean(strings.TrimSpace(root.Path))
	if rootPath == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(rootPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, []SkillCatalogNotice{{Path: rootPath, Message: err.Error()}}
	}
	out := make([]SkillMeta, 0, len(entries))
	notices := make([]SkillCatalogNotice, 0)
	for _, entry := range entries {
		if entry == nil || !entry.IsDir() {
			continue
		}
		dirName := strings.TrimSpace(entry.Name())
		if dirName == "" {
			continue
		}
		skillFile := filepath.Join(rootPath, dirName, "SKILL.md")
		if _, err := os.Stat(skillFile); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			notices = append(notices, SkillCatalogNotice{Path: skillFile, Message: err.Error()})
			continue
		}
		meta, _, err := parseSkillFile(skillFile, root.Scope)
		if err != nil {
			notices = append(notices, SkillCatalogNotice{Path: skillFile, Message: err.Error()})
			continue
		}
		if meta.Name != dirName {
			notices = append(notices, SkillCatalogNotice{Path: skillFile, Message: fmt.Sprintf("skill name %q does not match directory %q", meta.Name, dirName)})
			continue
		}
		out = append(out, meta)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority == out[j].Priority {
			return out[i].Name < out[j].Name
		}
		return out[i].Priority > out[j].Priority
	})
	return out, notices
}

func parseSkillFile(path string, scope string) (SkillMeta, string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return SkillMeta{}, "", err
	}
	frontmatterRaw, body, ok := splitFrontmatter(string(content))
	if !ok {
		return SkillMeta{}, "", fmt.Errorf("missing frontmatter")
	}
	var fm skillFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatterRaw), &fm); err != nil {
		return SkillMeta{}, "", err
	}
	fm.Name = strings.TrimSpace(fm.Name)
	fm.Description = strings.TrimSpace(fm.Description)
	if fm.Name == "" || fm.Description == "" {
		return SkillMeta{}, "", fmt.Errorf("invalid frontmatter")
	}
	allowImplicit := true
	if fm.Policy.AllowImplicitInvocation != nil {
		allowImplicit = *fm.Policy.AllowImplicitInvocation
	}
	modeHints := make([]string, 0, len(fm.ModeHint))
	for _, hint := range fm.ModeHint {
		v := strings.TrimSpace(strings.ToLower(hint))
		if v == "" {
			continue
		}
		modeHints = append(modeHints, v)
	}
	deps := make([]SkillMCPDependency, 0, len(fm.Dependencies.MCPServers))
	for _, dep := range fm.Dependencies.MCPServers {
		name := strings.TrimSpace(dep.Name)
		if name == "" {
			continue
		}
		deps = append(deps, SkillMCPDependency{
			Name:      name,
			Transport: strings.TrimSpace(dep.Transport),
			Command:   strings.TrimSpace(dep.Command),
			URL:       strings.TrimSpace(dep.URL),
		})
	}
	meta := SkillMeta{
		Name:                    fm.Name,
		Description:             fm.Description,
		Path:                    filepath.Clean(path),
		Scope:                   strings.TrimSpace(scope),
		Priority:                fm.Priority,
		ModeHints:               modeHints,
		AllowImplicitInvocation: allowImplicit,
		Dependencies:            deps,
	}
	return meta, strings.TrimSpace(body), nil
}

func splitFrontmatter(raw string) (frontmatter string, body string, ok bool) {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	if !strings.HasPrefix(raw, "---\n") {
		return "", strings.TrimSpace(raw), false
	}
	lines := strings.Split(raw, "\n")
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end <= 0 {
		return "", strings.TrimSpace(raw), false
	}
	front := strings.Join(lines[1:end], "\n")
	bodyPart := ""
	if end+1 < len(lines) {
		bodyPart = strings.Join(lines[end+1:], "\n")
	}
	return strings.TrimSpace(front), strings.TrimSpace(bodyPart), true
}

func (m *skillManager) List(mode string) []SkillMeta {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SkillMeta, 0, len(m.candidatesByName))
	for _, name := range sortedSkillNames(m.candidatesByName) {
		meta, ok := m.resolveCandidateLocked(name, mode, false)
		if !ok {
			continue
		}
		out = append(out, meta)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority == out[j].Priority {
			return out[i].Name < out[j].Name
		}
		return out[i].Priority > out[j].Priority
	})
	return out
}

func (m *skillManager) Activate(name string, mode string, implicit bool) (SkillActivation, bool, error) {
	if m == nil {
		return SkillActivation{}, false, fmt.Errorf("nil skill manager")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return SkillActivation{}, false, fmt.Errorf("missing skill name")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if activation, ok := m.active[name]; ok {
		return activation, true, nil
	}
	meta, ok := m.resolveCandidateLocked(name, mode, implicit)
	if !ok {
		return SkillActivation{}, false, fmt.Errorf("unknown skill: %s", name)
	}
	_, body, err := parseSkillFile(meta.Path, meta.Scope)
	if err != nil {
		return SkillActivation{}, false, err
	}
	activationID := fmt.Sprintf("skill_%d", time.Now().UnixNano())
	activation := SkillActivation{
		ActivationID: activationID,
		Name:         meta.Name,
		RootDir:      filepath.Dir(meta.Path),
		Priority:     meta.Priority,
		Content:      body,
		ContentRef:   meta.Path,
		ModeHints:    append([]string(nil), meta.ModeHints...),
		Dependencies: append([]SkillMCPDependency(nil), meta.Dependencies...),
		ActivatedAt:  time.Now().UnixMilli(),
	}
	m.active[name] = activation
	return activation, false, nil
}

func (m *skillManager) Active() []SkillActivation {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SkillActivation, 0, len(m.active))
	for _, item := range m.active {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority == out[j].Priority {
			return out[i].Name < out[j].Name
		}
		return out[i].Priority > out[j].Priority
	})
	return out
}

func (m *skillManager) Deactivate(name string) {
	if m == nil {
		return
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, name)
}

func (m *skillManager) DeactivateAll() {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active = map[string]SkillActivation{}
}

func (m *skillManager) loadStateLocked() error {
	if m == nil || m.stateLoaded {
		return nil
	}
	m.stateLoaded = true
	m.disabledPaths = map[string]struct{}{}
	if strings.TrimSpace(m.statePath) == "" {
		return nil
	}
	raw, err := os.ReadFile(m.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var payload skillStateFile
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&payload); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != nil {
		if err != io.EOF {
			return err
		}
	}
	for _, path := range payload.DisabledPaths {
		path = filepath.Clean(strings.TrimSpace(path))
		if path == "" {
			continue
		}
		m.disabledPaths[path] = struct{}{}
	}
	return nil
}

func (m *skillManager) saveStateLocked() error {
	if m == nil || strings.TrimSpace(m.statePath) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(m.statePath), 0o700); err != nil {
		return err
	}
	paths := make([]string, 0, len(m.disabledPaths))
	for path := range m.disabledPaths {
		path = filepath.Clean(strings.TrimSpace(path))
		if path == "" {
			continue
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	payload := skillStateFile{SchemaVersion: 1}
	if len(paths) > 0 {
		payload.DisabledPaths = paths
	}
	buf, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.statePath + ".tmp"
	if err := os.WriteFile(tmp, append(buf, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, m.statePath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (m *skillManager) isDisabledLocked(path string) bool {
	if m == nil {
		return false
	}
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return false
	}
	_, ok := m.disabledPaths[path]
	return ok
}

func (m *skillManager) catalogLocked() SkillCatalog {
	if m == nil {
		return SkillCatalog{}
	}
	entries := make([]SkillCatalogEntry, 0, len(m.catalogEntries))
	for _, item := range m.catalogEntries {
		cloned := item
		cloned.ModeHints = append([]string(nil), item.ModeHints...)
		cloned.Dependencies = append([]SkillMCPDependency(nil), item.Dependencies...)
		entries = append(entries, cloned)
	}
	conflicts := make([]SkillCatalogNotice, 0, len(m.catalogConflict))
	conflicts = append(conflicts, m.catalogConflict...)
	errors := make([]SkillCatalogNotice, 0, len(m.catalogErrors))
	errors = append(errors, m.catalogErrors...)
	return SkillCatalog{
		CatalogVersion: m.catalogVersion,
		Skills:         entries,
		Conflicts:      conflicts,
		Errors:         errors,
	}
}

func (m *skillManager) hasCatalogPathLocked(path string) bool {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return false
	}
	for _, item := range m.catalogEntries {
		if item.Path == path {
			return true
		}
	}
	return false
}

func sortedSkillNames(grouped map[string][]SkillMeta) []string {
	out := make([]string, 0, len(grouped))
	for name := range grouped {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func skillID(scope string, path string) string {
	scope = strings.TrimSpace(scope)
	path = filepath.Clean(strings.TrimSpace(path))
	if scope == "" {
		scope = "unknown"
	}
	return scope + ":" + path
}

func (m *skillManager) resolveCandidateLocked(name string, mode string, implicit bool) (SkillMeta, bool) {
	items := m.candidatesByName[strings.TrimSpace(name)]
	for i := range items {
		item := items[i]
		if m.isDisabledLocked(item.Path) {
			continue
		}
		if !skillMatchesMode(item.ModeHints, mode) {
			continue
		}
		if implicit && !item.AllowImplicitInvocation {
			continue
		}
		return item, true
	}
	return SkillMeta{}, false
}

func skillMatchesMode(hints []string, mode string) bool {
	if len(hints) == 0 {
		return true
	}
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode == "" {
		return true
	}
	for _, hint := range hints {
		if strings.TrimSpace(strings.ToLower(hint)) == mode {
			return true
		}
	}
	return false
}
