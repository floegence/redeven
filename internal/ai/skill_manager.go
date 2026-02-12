package ai

import (
	"fmt"
	"os"
	"path/filepath"
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

type skillManager struct {
	mu         sync.RWMutex
	workspace  string
	userHome   string
	discovered map[string]SkillMeta
	active     map[string]SkillActivation
}

func newSkillManager(workspace string) *skillManager {
	home, _ := os.UserHomeDir()
	return &skillManager{
		workspace:  strings.TrimSpace(workspace),
		userHome:   strings.TrimSpace(home),
		discovered: map[string]SkillMeta{},
		active:     map[string]SkillActivation{},
	}
}

func (m *skillManager) roots() []skillDiscoveryRoot {
	roots := make([]skillDiscoveryRoot, 0, 5)
	if ws := strings.TrimSpace(m.workspace); ws != "" {
		roots = append(roots,
			skillDiscoveryRoot{Path: filepath.Join(ws, ".redeven", "skills"), Scope: "workspace"},
			skillDiscoveryRoot{Path: filepath.Join(ws, ".agents", "skills"), Scope: "workspace_agents"},
		)
	}
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

	seen := map[string]SkillMeta{}
	for _, root := range m.roots() {
		scanSkillRoot(root, seen)
	}
	m.discovered = seen
}

func scanSkillRoot(root skillDiscoveryRoot, out map[string]SkillMeta) {
	rootPath := filepath.Clean(strings.TrimSpace(root.Path))
	if rootPath == "" {
		return
	}
	entries, err := os.ReadDir(rootPath)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry == nil || !entry.IsDir() {
			continue
		}
		dirName := strings.TrimSpace(entry.Name())
		if dirName == "" {
			continue
		}
		skillFile := filepath.Join(rootPath, dirName, "SKILL.md")
		meta, _, err := parseSkillFile(skillFile, root.Scope)
		if err != nil {
			continue
		}
		if strings.TrimSpace(meta.Name) == "" {
			continue
		}
		if _, exists := out[meta.Name]; exists {
			continue
		}
		if meta.Name != dirName {
			continue
		}
		out[meta.Name] = meta
	}
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

func (m *skillManager) List() []SkillMeta {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SkillMeta, 0, len(m.discovered))
	for _, meta := range m.discovered {
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

func (m *skillManager) Activate(name string) (SkillActivation, bool, error) {
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
	meta, ok := m.discovered[name]
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
