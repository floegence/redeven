// Package agentplugins implements Flower's Agent Plugins 1.0.0 package admission.
// It owns no conversation, tool execution, approval, or MCP protocol lifecycle.
package agentplugins

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/http/httpguts"
	"gopkg.in/yaml.v3"
)

const ManifestSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
const MCPSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
const MaxFileBytes = 16 << 20
const MaxPackageBytes = 128 << 20
const MaxFiles = 4096
const MaxConfigBytes = 1 << 20

type Manifest struct {
	Schema      string            `json:"$schema"`
	Name        string            `json:"name"`
	Version     string            `json:"version,omitempty"`
	Description string            `json:"description,omitempty"`
	Author      map[string]string `json:"author,omitempty"`
	Homepage    string            `json:"homepage,omitempty"`
	Repository  string            `json:"repository,omitempty"`
	License     string            `json:"license,omitempty"`
	Keywords    []string          `json:"keywords,omitempty"`
}
type Diagnostic struct {
	Component string `json:"component"`
	Code      string `json:"code"`
	Detail    string `json:"detail,omitempty"`
}
type Skill struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Path        string `json:"path"`
}
type MCP struct {
	Type    string            `json:"type"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	CWD     string            `json:"cwd,omitempty"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}
type Package struct {
	Manifest    Manifest       `json:"manifest"`
	Skills      []Skill        `json:"skills"`
	MCP         map[string]MCP `json:"mcp"`
	Diagnostics []Diagnostic   `json:"diagnostics"`
}

var pluginName = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`)
var skillName = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

// Within resolves existing ancestors too, so missing paths cannot hide a symlink escape.
func Within(root, path string) (string, error) {
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", err
	}
	boundary, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer boundary.Close()
	tail := []string{}
	resolved := path
	for {
		candidate, e := filepath.EvalSymlinks(resolved)
		if e == nil {
			resolved = candidate
			break
		}
		if !os.IsNotExist(e) {
			return "", e
		}
		relative, relErr := filepath.Rel(root, resolved)
		if relErr != nil || !filepath.IsLocal(relative) {
			return "", errors.New("package path escapes its root")
		}
		if _, e = boundary.Lstat(relative); e == nil {
			return "", errors.New("unresolved package link")
		}
		parent := filepath.Dir(resolved)
		if parent == resolved {
			return "", errors.New("unresolved package path")
		}
		tail = append(tail, filepath.Base(resolved))
		resolved = parent
	}
	for i := len(tail) - 1; i >= 0; i-- {
		resolved = filepath.Join(resolved, tail[i])
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", errors.New("package path escapes its root")
	}
	return resolved, nil
}

func readFile(root, path string) ([]byte, error) {
	p, err := Within(root, path)
	if err != nil {
		return nil, err
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	relative, err := filepath.Rel(realRoot, p)
	if err != nil {
		return nil, err
	}
	boundary, err := os.OpenRoot(realRoot)
	if err != nil {
		return nil, err
	}
	defer boundary.Close()
	f, err := boundary.Open(relative)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > MaxConfigBytes {
		return nil, errors.New("invalid or oversized component file")
	}
	b, err := io.ReadAll(io.LimitReader(f, MaxConfigBytes+1))
	if len(b) > MaxConfigBytes {
		return nil, errors.New("component file exceeds limit")
	}
	return b, err
}
func object(b []byte) (map[string]json.RawMessage, error) {
	d := json.NewDecoder(bytes.NewReader(b))
	var m map[string]json.RawMessage
	if err := d.Decode(&m); err != nil {
		return nil, err
	}
	if m == nil {
		return nil, errors.New("expected JSON object")
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, errors.New("trailing JSON")
	}
	return m, nil
}
func isString(b json.RawMessage) bool {
	var s string
	return len(b) > 0 && b[0] == '"' && json.Unmarshal(b, &s) == nil
}
func Load(root string) (Package, error) {
	p := Package{Skills: []Skill{}, MCP: map[string]MCP{}, Diagnostics: []Diagnostic{}}
	b, err := readFile(root, filepath.Join(root, "plugin.json"))
	if err != nil {
		return p, fmt.Errorf("plugin.json: %w", err)
	}
	m, err := object(b)
	if err != nil {
		return p, err
	}
	allowed := map[string]bool{"$schema": true, "name": true, "version": true, "description": true, "author": true, "homepage": true, "repository": true, "license": true, "keywords": true, "extensions": true}
	for k, v := range m {
		if !allowed[k] {
			p.Diagnostics = append(p.Diagnostics, Diagnostic{"manifest", "unknown_field", k})
			delete(m, k)
			continue
		}
		switch k {
		case "extensions":
			if _, e := object(v); e != nil {
				p.Diagnostics = append(p.Diagnostics, Diagnostic{"manifest", "invalid_extensions", ""})
			}
			delete(m, k)
		case "author":
			author, e := object(v)
			if e != nil {
				return p, errors.New("invalid author")
			}
			for key, value := range author {
				if (key != "name" && key != "email" && key != "url") || !isString(value) {
					return p, errors.New("invalid author field")
				}
			}
		case "keywords":
			var values []json.RawMessage
			if len(v) == 0 || v[0] != '[' || json.Unmarshal(v, &values) != nil {
				return p, errors.New("invalid keywords")
			}
			for _, value := range values {
				if !isString(value) {
					return p, errors.New("invalid keyword")
				}
			}
		default:
			if !isString(v) {
				return p, fmt.Errorf("invalid manifest field: %s", k)
			}
		}
	}
	b, _ = json.Marshal(m)
	if err = json.Unmarshal(b, &p.Manifest); err != nil {
		return p, err
	}
	n := p.Manifest.Name
	if p.Manifest.Schema != ManifestSchema {
		return p, errors.New("unsupported Agent Plugins manifest schema")
	}
	if len(n) > 64 || !pluginName.MatchString(n) || strings.Contains(n, "--") || strings.Contains(n, "..") {
		return p, errors.New("invalid plugin name")
	}
	p.loadSkills(root)
	p.loadMCP(root)
	sort.Slice(p.Diagnostics, func(i, j int) bool {
		a, b := p.Diagnostics[i], p.Diagnostics[j]
		return a.Component+a.Code+a.Detail < b.Component+b.Code+b.Detail
	})
	return p, nil
}
func (p *Package) loadSkills(root string) {
	path := filepath.Join(root, "skills")
	if _, e := os.Lstat(path); os.IsNotExist(e) {
		return
	}
	safe, e := Within(root, path)
	if e != nil {
		p.Diagnostics = append(p.Diagnostics, Diagnostic{"skills", "invalid_component", ""})
		return
	}
	entries, e := os.ReadDir(safe)
	if e != nil {
		p.Diagnostics = append(p.Diagnostics, Diagnostic{"skills", "invalid_component", ""})
		return
	}
	for _, entry := range entries {
		dir := filepath.Join(safe, entry.Name())
		st, err := os.Stat(dir)
		if err != nil || !st.IsDir() {
			continue
		}
		path := filepath.Join(dir, "SKILL.md")
		if _, err = os.Lstat(path); os.IsNotExist(err) {
			continue
		}
		b, err := readFile(root, path)
		var s Skill
		if err == nil {
			s, err = ParseSkill(b, entry.Name())
		}
		if err != nil {
			p.Diagnostics = append(p.Diagnostics, Diagnostic{"skill:" + entry.Name(), "invalid_skill", ""})
			continue
		}
		s.Key = "skill:" + entry.Name()
		s.Path = filepath.ToSlash(filepath.Join("skills", entry.Name(), "SKILL.md"))
		p.Skills = append(p.Skills, s)
	}
}
func ParseSkill(b []byte, dir string) (Skill, error) {
	s := Skill{}
	raw := strings.ReplaceAll(string(b), "\r\n", "\n")
	if !utf8.Valid(b) || !strings.HasPrefix(raw, "---\n") {
		return s, errors.New("missing skill frontmatter")
	}
	end := strings.Index(raw[4:], "\n---\n")
	if end < 0 && strings.HasSuffix(raw, "\n---") {
		end = len(raw) - 8
	}
	if end < 0 {
		return s, errors.New("missing skill frontmatter terminator")
	}
	var fm map[string]any
	if e := yaml.Unmarshal([]byte(raw[4:4+end]), &fm); e != nil {
		return s, e
	}
	s.Name, _ = fm["name"].(string)
	s.Description, _ = fm["description"].(string)
	if s.Name != dir || len(s.Name) > 64 || !skillName.MatchString(s.Name) || strings.Contains(s.Name, "--") || strings.TrimSpace(s.Description) == "" || utf8.RuneCountInString(s.Description) > 1024 {
		return s, errors.New("invalid skill metadata")
	}
	for _, key := range []string{"license", "compatibility", "allowed-tools"} {
		if v, ok := fm[key]; ok {
			str, yes := v.(string)
			if !yes || (key == "compatibility" && (len(str) == 0 || utf8.RuneCountInString(str) > 500)) {
				return s, errors.New("invalid skill metadata")
			}
		}
	}
	if v, ok := fm["metadata"]; ok {
		values, yes := v.(map[string]any)
		if !yes {
			return s, errors.New("invalid skill metadata")
		}
		for _, value := range values {
			if _, yes = value.(string); !yes {
				return s, errors.New("invalid skill metadata")
			}
		}
	}
	return s, nil
}
func (p *Package) loadMCP(root string) {
	path := filepath.Join(root, "mcp.json")
	if _, e := os.Lstat(path); os.IsNotExist(e) {
		return
	}
	b, e := readFile(root, path)
	m, err := object(b)
	if e != nil || err != nil {
		p.Diagnostics = append(p.Diagnostics, Diagnostic{"mcp", "invalid_component", ""})
		return
	}
	var schema string
	servers, e := object(m["mcpServers"])
	if len(m) != 2 || json.Unmarshal(m["$schema"], &schema) != nil || schema != MCPSchema || e != nil {
		p.Diagnostics = append(p.Diagnostics, Diagnostic{"mcp", "invalid_component", ""})
		return
	}
	for key, value := range servers {
		config, e := parseMCP(value)
		if e == nil {
			e = validatePackagePaths(root, config)
		}
		if e != nil {
			p.Diagnostics = append(p.Diagnostics, Diagnostic{"mcp:" + key, "invalid_server", ""})
			continue
		}
		if config.Type == "sse" {
			p.Diagnostics = append(p.Diagnostics, Diagnostic{"mcp:" + key, "unsupported_transport", "sse"})
			continue
		}
		p.MCP[key] = config
	}
}
func parseMCP(b []byte) (MCP, error) {
	c := MCP{}
	m, e := object(b)
	if e != nil {
		return c, e
	}
	if json.Unmarshal(b, &c) != nil {
		return c, errors.New("invalid MCP fields")
	}
	fields := map[string]bool{"type": true}
	switch c.Type {
	case "stdio":
		for _, k := range []string{"command", "args", "env", "cwd"} {
			fields[k] = true
		}
		if c.Command == "" || strings.ContainsAny(c.Command, "\x00\r\n") {
			return c, errors.New("invalid command")
		}
	case "streamable-http", "sse":
		fields["url"] = true
		fields["headers"] = true
		if e = ValidateURL(c.URL); e != nil {
			return c, e
		}
	default:
		return c, errors.New("invalid transport")
	}
	for k, v := range m {
		if !fields[k] {
			return c, errors.New("unknown server field")
		}
		switch k {
		case "args":
			var arr []json.RawMessage
			if len(v) == 0 || v[0] != '[' || json.Unmarshal(v, &arr) != nil {
				return c, errors.New("invalid arguments")
			}
			for _, x := range arr {
				if !isString(x) {
					return c, errors.New("invalid argument")
				}
			}
		case "env", "headers":
			obj, err := object(v)
			if err != nil {
				return c, err
			}
			for _, x := range obj {
				if !isString(x) {
					return c, errors.New("invalid configuration value")
				}
			}
		default:
			if !isString(v) {
				return c, errors.New("invalid server field")
			}
		}
	}
	seen := map[string]bool{}
	for k, v := range c.Headers {
		fold := strings.ToLower(k)
		if seen[fold] || !httpguts.ValidHeaderFieldName(k) || !httpguts.ValidHeaderFieldValue(v) {
			return c, errors.New("invalid headers")
		}
		seen[fold] = true
	}
	seen = map[string]bool{}
	for k, v := range c.Env {
		if seen[strings.ToLower(k)] || strings.EqualFold(k, "PLUGIN_ROOT") || strings.EqualFold(k, "PLUGIN_DATA") || k == "" || strings.ContainsAny(k, "=\x00") || strings.ContainsRune(v, 0) {
			return c, errors.New("invalid environment")
		}
		seen[strings.ToLower(k)] = true
	}
	for _, arg := range c.Args {
		if strings.ContainsRune(arg, 0) {
			return c, errors.New("invalid argument")
		}
	}
	return c, nil
}
func ValidateURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return errors.New("invalid MCP URL")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme == "http" && u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return errors.New("remote MCP requires HTTPS")
	}
	return nil
}
func validateMCPPathSyntax(c MCP) error {
	if c.Type != "stdio" {
		return nil
	}
	if strings.HasPrefix(c.Command, "./") {
		if !portableRelativePath(path.Clean(strings.TrimPrefix(c.Command, "./"))) || strings.ContainsAny(c.Command, "\\:\x00") {
			return errors.New("invalid package executable")
		}
	} else if strings.ContainsAny(c.Command, "/\\: \t") || strings.Contains(c.Command, "$"+"{") || c.Command == "." || c.Command == ".." {
		return errors.New("command must be an executable token")
	}
	if c.CWD == "" {
		return nil
	}
	for _, base := range []string{"./", "$" + "{PLUGIN_ROOT}", "$" + "{PLUGIN_DATA}"} {
		if (base == "./" && strings.HasPrefix(c.CWD, base)) || c.CWD == base || strings.HasPrefix(c.CWD, base+"/") {
			tail := strings.TrimPrefix(strings.TrimPrefix(c.CWD, base), "/")
			if tail == "" {
				return nil
			}
			if strings.Contains(tail, "$"+"{") || strings.ContainsAny(tail, "\\:\x00") || !portableRelativePath(path.Clean(tail)) {
				return errors.New("invalid cwd")
			}
			return nil
		}
	}
	return errors.New("invalid cwd")
}
func validatePackagePaths(root string, c MCP) error {
	if err := validateMCPPathSyntax(c); err != nil {
		return err
	}
	if c.Type != "stdio" {
		return nil
	}
	if strings.HasPrefix(c.Command, "./") {
		if _, e := Within(root, filepath.Join(root, c.Command)); e != nil {
			return e
		}
	} else if strings.ContainsAny(c.Command, "/\\ 	") || strings.Contains(c.Command, "${") || c.Command == "." || c.Command == ".." {
		return errors.New("command must be an executable token")
	}
	if c.CWD == "" {
		return nil
	}
	if strings.HasPrefix(c.CWD, "./") {
		_, e := Within(root, filepath.Join(root, c.CWD))
		return e
	}
	for _, base := range []string{"${PLUGIN_ROOT}", "${PLUGIN_DATA}"} {
		if c.CWD == base || strings.HasPrefix(c.CWD, base+"/") {
			tail := strings.TrimPrefix(c.CWD, base)
			if strings.Contains(tail, "${") {
				return errors.New("invalid cwd")
			}
			if base == "${PLUGIN_ROOT}" {
				_, e := Within(root, filepath.Join(root, tail))
				return e
			}
			clean := filepath.Clean(strings.TrimPrefix(tail, "/"))
			if clean == ".." || strings.HasPrefix(clean, "../") {
				return errors.New("data cwd escapes root")
			}
			return nil
		}
	}
	return errors.New("invalid cwd")
}

// Resolve applies only the two standard variables, once. It never evaluates a shell.
func (c MCP) Resolve(root, data string) (MCP, error) {
	if c.Type != "stdio" {
		return c, nil
	}
	var e error
	root, e = filepath.EvalSymlinks(root)
	if e != nil {
		return c, e
	}
	root, _ = filepath.Abs(root)
	data, e = filepath.EvalSymlinks(data)
	if e != nil {
		return c, e
	}
	data, _ = filepath.Abs(data)
	if e = validatePackagePaths(root, c); e != nil {
		return c, e
	}
	replace := strings.NewReplacer("${PLUGIN_ROOT}", root, "${PLUGIN_DATA}", data)
	args := make([]string, len(c.Args))
	for i, v := range c.Args {
		args[i] = replace.Replace(v)
	}
	c.Args = args
	env := map[string]string{}
	for k, v := range c.Env {
		env[k] = replace.Replace(v)
	}
	env["PLUGIN_ROOT"] = root
	env["PLUGIN_DATA"] = data
	c.Env = env
	base := root
	if strings.HasPrefix(c.CWD, "${PLUGIN_DATA}") {
		base = data
	}
	cwd := replace.Replace(c.CWD)
	if cwd == "" {
		cwd = root
	} else if strings.HasPrefix(cwd, "./") {
		cwd = filepath.Join(root, cwd)
	}
	c.CWD, e = Within(base, cwd)
	if e != nil {
		return c, e
	}
	if strings.HasPrefix(c.Command, "./") {
		c.Command, e = Within(root, filepath.Join(root, c.Command))
	}
	return c, e
}
