package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/agentplugins"
	"golang.org/x/net/http/httpguts"
)

func pluginServerID(id, key string) string {
	h := sha256.Sum256([]byte(id + "/" + key))
	return "ap_" + hex.EncodeToString(h[:16])
}
func pluginMCPToolName(server mcpServerRecord, tool mcpToolRecord) string {
	b, _ := json.Marshal(struct {
		Install, Digest, Component, Credential string
		Revision                               int64
		Tool                                   mcpToolRecord
	}{server.pluginID, server.pluginDigest, server.componentKey, server.credentialRef, server.Revision, tool})
	h := sha256.Sum256(b)
	return "mcp_" + server.ID + "_" + hex.EncodeToString(h[:8])
}
func (m *mcpManager) allServersLocked() []mcpServerRecord {
	out := append([]mcpServerRecord{}, m.servers...)
	if m.plugins == nil {
		return out
	}
	installs, _ := m.plugins.List()
	for _, in := range installs {
		keys := make([]string, 0, len(in.Package.MCP))
		for key := range in.Package.MCP {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, name := range keys {
			key := "mcp:" + name
			c := in.Components[key]
			config := in.Package.MCP[name]
			transport := "http"
			if config.Type == "stdio" {
				transport = "stdio"
			}
			record := mcpServerRecord{MCPServerInput: MCPServerInput{ID: pluginServerID(in.ID, key), Revision: in.Revision, Name: in.Package.Manifest.Name + " / " + name, Transport: transport, URL: config.URL, Command: config.Command, Args: config.Args, Enabled: in.Enabled && c.Enabled}, pluginID: in.ID, componentKey: key, pluginDigest: in.Digest, credentialRef: c.CredentialRef, CheckedAt: c.CheckedAt, Tools: []mcpToolRecord{}}
			for _, tool := range c.Tools {
				record.Tools = append(record.Tools, mcpToolRecord{Name: tool.Name, Description: tool.Description, Schema: tool.Schema})
			}
			out = append(out, record)
		}
	}
	return out
}
func (m *mcpManager) pluginMCPInput(in agentplugins.Install, key string) (MCPServerInput, error) {
	config, ok := in.Package.MCP[strings.TrimPrefix(key, "mcp:")]
	if !ok || !strings.HasPrefix(key, "mcp:") {
		return MCPServerInput{}, agentplugins.ErrUnavailable
	}
	resolved, e := config.Resolve(m.plugins.Root(in), m.plugins.Data(in.ID))
	if e != nil {
		return MCPServerInput{}, e
	}
	credentials, e := m.pluginSecrets.AgentPluginCredential(in.Components[key].CredentialRef)
	if e != nil {
		return MCPServerInput{}, e
	}
	if e = validatePluginCredentials(config.Type, credentials); e != nil {
		return MCPServerInput{}, e
	}
	transport := "http"
	if resolved.Type == "stdio" {
		transport = "stdio"
		resolved.Env = maps.Clone(resolved.Env)
		for k, v := range credentials {
			if runtime.GOOS == "windows" {
				for existing := range resolved.Env {
					if strings.EqualFold(existing, k) {
						delete(resolved.Env, existing)
					}
				}
			}
			resolved.Env[k] = v
		}
	} else {
		resolved.Headers = maps.Clone(resolved.Headers)
		if resolved.Headers == nil {
			resolved.Headers = map[string]string{}
		}
		for k, v := range credentials {
			for existing := range resolved.Headers {
				if strings.EqualFold(k, existing) {
					delete(resolved.Headers, existing)
				}
			}
			resolved.Headers[http.CanonicalHeaderKey(k)] = v
		}
	}
	return MCPServerInput{ID: pluginServerID(in.ID, key), Revision: in.Revision, Name: in.Package.Manifest.Name + " / " + strings.TrimPrefix(key, "mcp:"), Transport: transport, URL: resolved.URL, Command: resolved.Command, Args: resolved.Args, Env: resolved.Env, Headers: resolved.Headers, Enabled: in.Enabled && in.Components[key].Enabled, cwd: resolved.CWD}, nil
}
func validatePluginCredentials(transport string, values map[string]string) error {
	seen := map[string]bool{}
	for key, value := range values {
		if len(value) > 8192 || strings.ContainsRune(value, 0) {
			return errors.New("invalid_credentials")
		}
		fold := strings.ToLower(key)
		if seen[fold] {
			return errors.New("invalid_credentials")
		}
		seen[fold] = true
		if transport == "stdio" {
			if !mcpEnvPattern.MatchString(key) || strings.EqualFold(key, "PLUGIN_ROOT") || strings.EqualFold(key, "PLUGIN_DATA") {
				return errors.New("invalid_credentials")
			}
		} else if !httpguts.ValidHeaderFieldName(key) || !httpguts.ValidHeaderFieldValue(value) || fold == "host" || fold == "content-length" || fold == "content-type" || fold == "accept" || fold == "connection" || strings.HasPrefix(fold, "mcp-") {
			return errors.New("invalid_credentials")
		}
	}
	return nil
}
func (m *mcpManager) checkPlugin(ctx context.Context, id string, revision int64, key string, canLaunch bool) error {
	in, release, e := m.plugins.Acquire(id, revision, key)
	if e != nil {
		return e
	}
	defer release()
	config, e := m.pluginMCPInput(in, key)
	if e != nil {
		return e
	}
	if config.Transport == "stdio" && !canLaunch {
		return errors.New("process_permission_required")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	session, e := connectMCP(ctx, config)
	if e != nil {
		return errors.New("connection_failed")
	}
	defer session.Close()
	record := mcpServerRecord{MCPServerInput: config, Tools: []mcpToolRecord{}, pluginID: id, componentKey: key, pluginDigest: in.Digest, credentialRef: in.Components[key].CredentialRef, CheckedAt: time.Now().UnixMilli()}
	for tool, err := range session.Tools(ctx, nil) {
		if err != nil {
			return errors.New("discovery_failed")
		}
		schema, err := json.Marshal(tool.InputSchema)
		if err != nil {
			return errors.New("invalid_tool_schema")
		}
		record.Tools = append(record.Tools, mcpToolRecord{Name: tool.Name, Description: tool.Description, Schema: schema})
		if len(record.Tools) > 128 {
			return errors.New("tool_limit")
		}
	}
	if e = validateMCPTools(record.Tools); e != nil {
		return fmt.Errorf("invalid_tool_schema")
	}
	tools := make([]agentplugins.DiscoveredTool, 0, len(record.Tools))
	for _, tool := range record.Tools {
		tools = append(tools, agentplugins.DiscoveredTool{Name: tool.Name, Description: tool.Description, Schema: tool.Schema})
	}
	return m.plugins.RecordDiscovery(id, revision, key, tools)
}
func (m *mcpManager) pluginHealth(id string, revision int64, key string) (int64, int) {
	in, e := m.plugins.Get(id)
	if e != nil || in.Revision != revision {
		return 0, 0
	}
	c := in.Components[key]
	return c.CheckedAt, len(c.Tools)
}
