package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCP credentials are write-only through the management API. A nil secret map
// preserves existing values; an explicitly empty map clears them.
type MCPServerInput struct {
	ID        string            `json:"id"`
	Revision  int64             `json:"revision"`
	Name      string            `json:"name"`
	Transport string            `json:"transport"`
	URL       string            `json:"url,omitempty"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Enabled   bool              `json:"enabled"`
}

type mcpServerRecord struct {
	MCPServerInput
	Icons     []ExtensionIcon `json:"icons,omitempty"`
	Tools     []mcpToolRecord `json:"tools"`
	CheckedAt int64           `json:"checked_at"`
}
type mcpToolRecord struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"schema"`
}
type MCPServerView struct {
	Icons      []ExtensionIcon `json:"icons,omitempty"`
	ID         string          `json:"id"`
	Revision   int64           `json:"revision"`
	Name       string          `json:"name"`
	Transport  string          `json:"transport"`
	URL        string          `json:"url,omitempty"`
	Command    string          `json:"command,omitempty"`
	Args       []string        `json:"args,omitempty"`
	HeaderKeys []string        `json:"header_keys"`
	EnvKeys    []string        `json:"env_keys"`
	Enabled    bool            `json:"enabled"`
	Tools      []mcpToolRecord `json:"tools"`
	CheckedAt  int64           `json:"checked_at"`
}
type MCPCatalog struct {
	Servers []MCPServerView `json:"servers"`
}
type mcpStore struct {
	SchemaVersion int               `json:"schema_version"`
	Revision      int64             `json:"revision"`
	Servers       []mcpServerRecord `json:"servers"`
}
type mcpManager struct {
	mu       sync.RWMutex
	path     string
	servers  []mcpServerRecord
	revision int64
}

var mcpIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}$`)
var mcpEnvPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var errMCPConflict = errors.New("MCP configuration changed; refresh and try again")
var errMCPEffectUnknown = errors.New("MCP tool outcome is unknown; do not repeat the operation")

func openMCPManager(stateDir string) (*mcpManager, error) {
	m := &mcpManager{path: filepath.Join(stateDir, "ai", "mcp.json"), servers: []mcpServerRecord{}}
	data, err := os.ReadFile(m.path)
	if errors.Is(err, os.ErrNotExist) {
		return m, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read MCP configuration: %w", err)
	}
	if len(data) > 4<<20 {
		return nil, errors.New("MCP configuration exceeds size limit")
	}
	var version struct {
		SchemaVersion int `json:"schema_version"`
	}
	if json.Unmarshal(data, &version) != nil || (version.SchemaVersion != 1 && version.SchemaVersion != 2) {
		return nil, errors.New("unsupported MCP configuration; original file preserved")
	}
	var store mcpStore
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var decodeErr error
	if version.SchemaVersion == 1 {
		// Keep the exact v1 shape frozen: presentation fields belong only to v2.
		var legacy struct {
			SchemaVersion int   `json:"schema_version"`
			Revision      int64 `json:"revision"`
			Servers       []struct {
				MCPServerInput
				Tools     []mcpToolRecord `json:"tools"`
				CheckedAt int64           `json:"checked_at"`
			} `json:"servers"`
		}
		decodeErr = decoder.Decode(&legacy)
		store.SchemaVersion, store.Revision = legacy.SchemaVersion, legacy.Revision
		if legacy.Servers != nil {
			store.Servers = make([]mcpServerRecord, 0, len(legacy.Servers))
			for _, entry := range legacy.Servers {
				store.Servers = append(store.Servers, mcpServerRecord{MCPServerInput: entry.MCPServerInput, Tools: entry.Tools, CheckedAt: entry.CheckedAt})
			}
		}
	} else {
		decodeErr = decoder.Decode(&store)
	}
	if decodeErr != nil {
		return nil, errors.New("invalid MCP configuration; original file preserved")
	}
	if decoder.Decode(&struct{}{}) != io.EOF || store.Revision < 1 || store.Servers == nil || len(store.Servers) > 32 {
		return nil, errors.New("unsupported MCP configuration; original file preserved")
	}
	seen := map[string]bool{}
	for _, entry := range store.Servers {
		if err := validateMCPServer(entry.MCPServerInput); err != nil || entry.Revision < 1 || entry.Revision > store.Revision || entry.CheckedAt < 0 || entry.Tools == nil || seen[entry.ID] || validateMCPTools(entry.Tools) != nil || !validMCPCatalogIcons(entry.Icons) {
			return nil, errors.New("invalid MCP configuration; original file preserved")
		}
		seen[entry.ID] = true
	}
	if store.SchemaVersion == 1 {
		if err := m.persistRevision(store.Servers, store.Revision); err != nil {
			return nil, fmt.Errorf("upgrade MCP configuration: %w", err)
		}
	}
	m.servers = store.Servers
	m.revision = store.Revision
	return m, nil
}

func validateMCPServer(input MCPServerInput) error {
	if !mcpIDPattern.MatchString(input.ID) || strings.TrimSpace(input.Name) == "" || len(input.Name) > 120 {
		return errors.New("provide a name and a lowercase server ID")
	}
	if len(input.URL) > 8192 || len(input.Command) > 8192 {
		return errors.New("MCP endpoint or executable exceeds the field limit")
	}
	switch input.Transport {
	case "http":
		u, err := url.Parse(input.URL)
		if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" || (u.Scheme != "http" && u.Scheme != "https") || input.Command != "" || len(input.Args) > 0 || len(input.Env) > 0 {
			return errors.New("provide an HTTP endpoint without credentials, query, or command fields")
		}
		if u.Scheme == "http" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
			return errors.New("remote MCP endpoints require HTTPS")
		}
	case "stdio":
		if strings.TrimSpace(input.Command) == "" || strings.ContainsAny(input.Command, "\x00\r\n") || input.URL != "" || len(input.Headers) > 0 {
			return errors.New("provide a local executable without HTTP fields")
		}
	default:
		return errors.New("unsupported MCP transport")
	}
	if len(input.Args) > 64 || len(input.Headers) > 32 || len(input.Env) > 64 {
		return errors.New("MCP configuration exceeds field limits")
	}
	for _, arg := range input.Args {
		if len(arg) > 8192 || strings.ContainsRune(arg, 0) {
			return errors.New("invalid command argument")
		}
	}
	for key, value := range input.Headers {
		name := http.CanonicalHeaderKey(key)
		if !mcpEnvPattern.MatchString(strings.ReplaceAll(key, "-", "_")) || strings.ContainsAny(value, "\r\n\x00") || len(value) > 8192 || name == "Host" || name == "Content-Length" || name == "Connection" || strings.HasPrefix(name, "Mcp-") || name == "Content-Type" || name == "Accept" {
			return errors.New("invalid MCP HTTP header")
		}
	}
	for key, value := range input.Env {
		if !mcpEnvPattern.MatchString(key) || strings.ContainsRune(value, 0) || len(value) > 8192 {
			return errors.New("invalid MCP environment variable")
		}
	}
	return nil
}

func validateMCPTools(items []mcpToolRecord) error {
	if len(items) > 128 {
		return errors.New("MCP server exposes more than 128 tools")
	}
	names := map[string]bool{}
	for _, item := range items {
		var schema map[string]any
		if item.Name == "" || len(item.Name) > 128 || len(item.Description) > 16384 || names[item.Name] || len(item.Schema) > 32768 || json.Unmarshal(item.Schema, &schema) != nil || schema["type"] != "object" {
			return errors.New("MCP server returned an invalid tool definition")
		}
		names[item.Name] = true
	}
	return nil
}

func (m *mcpManager) List() MCPCatalog {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := MCPCatalog{Servers: make([]MCPServerView, 0, len(m.servers))}
	for _, entry := range m.servers {
		headers, env := []string{}, []string{}
		for key := range entry.Headers {
			headers = append(headers, key)
		}
		sort.Strings(headers)
		for key := range entry.Env {
			env = append(env, key)
		}
		sort.Strings(env)
		out.Servers = append(out.Servers, MCPServerView{ID: entry.ID, Revision: entry.Revision, Name: entry.Name, Transport: entry.Transport, URL: entry.URL, Command: entry.Command, Args: append([]string{}, entry.Args...), HeaderKeys: headers, EnvKeys: env, Enabled: entry.Enabled, Tools: append([]mcpToolRecord{}, entry.Tools...), CheckedAt: entry.CheckedAt, Icons: append([]ExtensionIcon(nil), entry.Icons...)})
	}
	return out
}

// Dependency declarations refer to the administrator's exact server ID. A
// declaration is metadata, never authority to install or start an MCP server.
func (m *mcpManager) HasDependency(dependency SkillMCPDependency) bool {
	if m == nil || dependency.Name == "" {
		return false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, server := range m.servers {
		if server.ID == dependency.Name && server.Enabled && server.CheckedAt > 0 {
			return (dependency.Transport == "" || dependency.Transport == server.Transport) &&
				(dependency.Command == "" || dependency.Command == server.Command) &&
				(dependency.URL == "" || dependency.URL == server.URL)
		}
	}
	return false
}

func (m *mcpManager) Save(ctx context.Context, input MCPServerInput) (MCPCatalog, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Headers = maps.Clone(input.Headers)
	input.Env = maps.Clone(input.Env)
	input.Args = append([]string{}, input.Args...)
	m.mu.RLock()
	var previous *mcpServerRecord
	for _, entry := range m.servers {
		if entry.ID == input.ID {
			copy := entry
			previous = &copy
			break
		}
	}
	m.mu.RUnlock()
	if (previous == nil && input.Revision != 0) || (previous != nil && input.Revision != previous.Revision) {
		return MCPCatalog{}, errMCPConflict
	}
	if previous != nil && previous.Transport == input.Transport {
		if input.Headers == nil {
			input.Headers = maps.Clone(previous.Headers)
		}
		if input.Env == nil {
			input.Env = maps.Clone(previous.Env)
		}
	}
	if err := validateMCPServer(input); err != nil {
		return MCPCatalog{}, err
	}
	next := mcpServerRecord{MCPServerInput: input, Tools: []mcpToolRecord{}}
	// Disabling remains possible while a server is unavailable.
	if input.Enabled {
		probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		session, err := connectMCP(probeCtx, input)
		if err != nil {
			return MCPCatalog{}, errors.New("MCP connection failed; check the endpoint, executable, and credentials")
		}
		defer session.Close()
		for tool, err := range session.Tools(probeCtx, nil) {
			if err != nil {
				return MCPCatalog{}, errors.New("MCP tool discovery failed")
			}
			schema, err := json.Marshal(tool.InputSchema)
			if err != nil {
				return MCPCatalog{}, errors.New("invalid MCP tool schema")
			}
			next.Tools = append(next.Tools, mcpToolRecord{Name: tool.Name, Description: tool.Description, Schema: schema})
			if len(next.Tools) > 128 {
				return MCPCatalog{}, errors.New("MCP server exposes more than 128 tools")
			}
		}
		if err := validateMCPTools(next.Tools); err != nil {
			return MCPCatalog{}, err
		}
		if initialized := session.InitializeResult(); initialized != nil && initialized.ServerInfo != nil {
			next.Icons = mcpCatalogIcons(probeCtx, input, initialized.ServerInfo.Icons)
		}
		next.CheckedAt = time.Now().UnixMilli()
	} else if previous != nil && sameMCPConnection(input, previous.MCPServerInput) {
		next.Tools = previous.Tools
		next.Icons = previous.Icons
		next.CheckedAt = previous.CheckedAt
	}
	m.mu.Lock()
	found := -1
	for i, entry := range m.servers {
		if entry.ID == input.ID {
			found = i
			break
		}
	}
	if (found < 0 && input.Revision != 0) || (found >= 0 && m.servers[found].Revision != input.Revision) {
		m.mu.Unlock()
		return MCPCatalog{}, errMCPConflict
	}
	next.Revision = m.revision + 1
	entries := append([]mcpServerRecord{}, m.servers...)
	if found >= 0 {
		entries[found] = next
	} else {
		if len(entries) >= 32 {
			m.mu.Unlock()
			return MCPCatalog{}, errors.New("MCP server limit reached")
		}
		entries = append(entries, next)
	}
	err := m.persist(entries)
	m.mu.Unlock()
	if err != nil {
		return MCPCatalog{}, err
	}
	return m.List(), nil
}

func sameMCPConnection(a, b MCPServerInput) bool {
	a.Name, b.Name = "", ""
	a.Revision, b.Revision = 0, 0
	a.Enabled, b.Enabled = false, false
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	return bytes.Equal(left, right)
}

func (m *mcpManager) Check(ctx context.Context, id string, revision int64) (MCPCatalog, error) {
	m.mu.RLock()
	var input *MCPServerInput
	for _, entry := range m.servers {
		if entry.ID == id && entry.Revision == revision {
			copy := entry.MCPServerInput
			input = &copy
		}
	}
	m.mu.RUnlock()
	if input == nil {
		return MCPCatalog{}, errMCPConflict
	}
	// An explicit check re-discovers only enabled servers; disabled entries must
	// be explicitly enabled before they can launch a process or provide tools.
	if !input.Enabled {
		return MCPCatalog{}, errors.New("enable the MCP server before checking its tools")
	}
	return m.Save(ctx, *input)
}

func (m *mcpManager) Delete(id string, revision int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	entries := make([]mcpServerRecord, 0, len(m.servers))
	found := false
	for _, entry := range m.servers {
		if entry.ID == id {
			if entry.Revision != revision {
				return errMCPConflict
			}
			found = true
		} else {
			entries = append(entries, entry)
		}
	}
	if !found {
		return errMCPConflict
	}
	return m.persist(entries)
}

func (m *mcpManager) persist(entries []mcpServerRecord) error {
	return m.persistRevision(entries, m.revision+1)
}

func (m *mcpManager) persistRevision(entries []mcpServerRecord, revision int64) error {
	data, err := json.MarshalIndent(mcpStore{SchemaVersion: 2, Revision: revision, Servers: entries}, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > 4<<20 {
		return errors.New("MCP configuration exceeds size limit")
	}
	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(m.path), ".mcp-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), m.path); err != nil {
		return err
	}
	m.servers = entries
	m.revision = revision
	return nil
}

type mcpHeaderTransport struct{ headers map[string]string }

func (t mcpHeaderTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	copy := req.Clone(req.Context())
	copy.Header = req.Header.Clone()
	for key, value := range t.headers {
		copy.Header.Set(key, value)
	}
	return http.DefaultTransport.RoundTrip(copy)
}
func connectMCP(ctx context.Context, input MCPServerInput) (*mcp.ClientSession, error) {
	var transport mcp.Transport
	if input.Transport == "stdio" {
		command := exec.CommandContext(ctx, input.Command, input.Args...)
		// Credentials from the parent process are not inherited by external tools.
		command.Env = []string{}
		for _, key := range []string{"PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP", "LANG"} {
			if value, ok := os.LookupEnv(key); ok {
				command.Env = append(command.Env, key+"="+value)
			}
		}
		for key, value := range input.Env {
			command.Env = append(command.Env, key+"="+value)
		}
		transport = &mcp.CommandTransport{Command: command, TerminateDuration: time.Second}
	} else {
		transport = &mcp.StreamableClientTransport{Endpoint: input.URL, HTTPClient: &http.Client{Transport: mcpHeaderTransport{headers: input.Headers}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("MCP redirects are not allowed") }}, MaxRetries: -1, DisableStandaloneSSE: true, MaxEventSize: 1 << 20}
	}
	return mcp.NewClient(&mcp.Implementation{Name: "Redeven Flower", Version: "1"}, nil).Connect(ctx, transport, nil)
}

func mcpToolName(server mcpServerRecord, tool mcpToolRecord) string {
	server.Revision = 0
	data, _ := json.Marshal(struct {
		Server MCPServerInput
		Tool   mcpToolRecord
	}{server.MCPServerInput, tool})
	hash := sha256.Sum256(data)
	id := server.ID
	if len(id) > 32 {
		id = id[:32]
	}
	return "mcp_" + id + "_" + hex.EncodeToString(hash[:8])
}

func (m *mcpManager) Tools() []ToolDef {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []ToolDef{}
	for _, server := range m.servers {
		if server.Enabled {
			for _, tool := range server.Tools {
				label := server.Name + " / " + tool.Name
				capabilities := []ToolCapabilityClass{ToolCapabilityMutation, ToolCapabilityOpenWorld}
				if server.Transport == "stdio" {
					capabilities = append(capabilities, ToolCapabilityShell)
				}
				out = append(out, ToolDef{Name: mcpToolName(server, tool), Description: label + ": " + tool.Description, InputSchema: tool.Schema, Mutating: true, RequiresApproval: true, Visibility: ToolVisibilityStandard, Capabilities: capabilities, Source: "mcp", Namespace: server.ID, Presentation: aitools.ToolPresentationSpec{Kind: aitools.ToolPresentationMutation, Risk: "approval", Renderer: "structured", CallLabelFallback: label, ResultLabelFallback: label, Grouping: aitools.ToolGroupingPolicy{GroupKey: "mcp"}, SummaryVersion: 1}})
			}
		}
	}
	return out
}

func (m *mcpManager) Call(ctx context.Context, name string, args map[string]any) (json.RawMessage, error) {
	if m == nil {
		return nil, errors.New("MCP is unavailable")
	}
	m.mu.RLock()
	var config *MCPServerInput
	var toolName string
	for _, server := range m.servers {
		if server.Enabled {
			for _, tool := range server.Tools {
				if mcpToolName(server, tool) == name {
					input := server.MCPServerInput
					config = &input
					toolName = tool.Name
				}
			}
		}
	}
	m.mu.RUnlock()
	if config == nil {
		return nil, errors.New("MCP tool configuration changed or is disabled")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	session, err := connectMCP(ctx, *config)
	if err != nil {
		return nil, errors.New("MCP connection failed before tool execution")
	}
	defer session.Close()
	// Connection setup can overlap an administrator edit. Recheck the exact
	// revision before dispatch; an already dispatched call retains its outcome.
	m.mu.RLock()
	available := false
	for _, server := range m.servers {
		if server.ID == config.ID && server.Enabled && server.Revision == config.Revision {
			available = true
			break
		}
	}
	m.mu.RUnlock()
	if !available {
		return nil, errors.New("MCP tool configuration changed or is disabled")
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: toolName, Arguments: args})
	if err != nil {
		return nil, errMCPEffectUnknown
	}
	data, err := json.Marshal(result)
	if err != nil {
		return nil, errMCPEffectUnknown
	}
	if len(data) > 1<<20 {
		data = json.RawMessage(`{"message":"MCP result exceeded the display limit","truncated":true}`)
	}
	if result.IsError {
		return data, errors.New("MCP server reported a tool error")
	}
	return data, nil
}

func (s *Service) ListMCPServers() (MCPCatalog, error) {
	if s == nil || s.mcpManager == nil {
		return MCPCatalog{}, errors.New("MCP is unavailable")
	}
	return s.mcpManager.List(), nil
}
func (s *Service) SaveMCPServer(ctx context.Context, input MCPServerInput) (MCPCatalog, error) {
	if _, err := s.ListMCPServers(); err != nil {
		return MCPCatalog{}, err
	}
	return s.mcpManager.Save(ctx, input)
}
func (s *Service) CheckMCPServer(ctx context.Context, id string, revision int64) (MCPCatalog, error) {
	if _, err := s.ListMCPServers(); err != nil {
		return MCPCatalog{}, err
	}
	return s.mcpManager.Check(ctx, id, revision)
}
func (s *Service) DeleteMCPServer(id string, revision int64) (MCPCatalog, error) {
	if _, err := s.ListMCPServers(); err != nil {
		return MCPCatalog{}, err
	}
	if err := s.mcpManager.Delete(id, revision); err != nil {
		return MCPCatalog{}, err
	}
	return s.mcpManager.List(), nil
}
