package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/ai/agentplugins"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
)

type AgentPluginView struct {
	agentplugins.Install
	Health map[string]AgentPluginHealth `json:"health"`
}
type AgentPluginHealth struct {
	Status    string `json:"status"`
	CheckedAt int64  `json:"checked_at"`
	Tools     int    `json:"tools"`
}
type AgentPluginsView struct {
	Operations []agentplugins.Operation     `json:"operations"`
	Items      []AgentPluginView            `json:"items"`
	Sources    []agentplugins.CatalogSource `json:"sources"`
	Revision   int64                        `json:"revision"`
	Target     string                       `json:"target"`
	CanLaunch  bool                         `json:"can_launch"`
}

func (s *Service) initializeAgentPlugins() error {
	catalogs, e := agentplugins.ParseCatalogConfig(os.Getenv("REDEVEN_AGENT_AI_PLUGIN_CATALOGS"))
	if e != nil {
		return e
	}
	m, e := agentplugins.OpenWithCatalogs(s.stateDir, catalogs)
	if e != nil {
		return e
	}
	s.agentPlugins = m
	s.skillManager.plugins = m
	s.mcpManager.plugins = m
	s.mcpManager.pluginSecrets = settings.NewSecretsStore(filepath.Join(s.stateDir, "secrets.json"))
	return nil
}
func pluginOwner(meta *session.Meta) string {
	return meta.NamespacePublicID + "/" + meta.EndpointID + "/" + meta.UserPublicID
}
func pluginAdmin(meta *session.Meta) error {
	if meta == nil || !meta.CanAdmin || !meta.CanRead {
		return errors.New("management_permission_required")
	}
	return nil
}
func (s *Service) ListAgentPlugins(meta *session.Meta) (AgentPluginsView, error) {
	out := AgentPluginsView{Items: []AgentPluginView{}}
	if s == nil || s.agentPlugins == nil {
		return out, errors.New("plugins_unavailable")
	}
	if meta == nil || !meta.CanRead {
		return out, errors.New("read_permission_required")
	}
	if meta.CanAdmin {
		out.Operations = s.agentPlugins.Operations(pluginOwner(meta))
	}
	installs, _ := s.agentPlugins.List()
	out.Sources, out.Revision = s.agentPlugins.Sources()
	out.Target = meta.EndpointID
	out.CanLaunch = session.AllowsProcessLaunch(meta)
	for _, in := range installs {
		view := AgentPluginView{Install: in, Health: map[string]AgentPluginHealth{}}
		for key, c := range in.Components {
			h := AgentPluginHealth{Status: "ready"}
			if !in.Enabled || !c.Enabled {
				h.Status = "disabled"
			} else if strings.HasPrefix(key, "mcp:") {
				h.CheckedAt, h.Tools = s.mcpManager.pluginHealth(in.ID, in.Revision, key)
				h.Status = "needs_check"
				if h.CheckedAt > 0 {
					h.Status = "ready"
				}
				if in.Package.MCP[strings.TrimPrefix(key, "mcp:")].Type == "stdio" && !out.CanLaunch {
					h.Status = "blocked"
				}
			}
			view.Health[key] = h
		}
		out.Items = append(out.Items, view)
	}
	return out, nil
}
func (s *Service) PrepareAgentPlugin(ctx context.Context, meta *session.Meta, req agentplugins.PrepareRequest) (agentplugins.Operation, error) {
	if e := pluginAdmin(meta); e != nil {
		return agentplugins.Operation{}, e
	}
	if req.Source.Type == "local" {
		resolved, e := s.scope.Resolve(req.Source.Directory, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
		if e != nil || !resolved.Permissions.Read {
			return agentplugins.Operation{}, errors.New("source_path_denied")
		}
		req.Source.Directory = resolved.RealAbs
	}
	if e := ctx.Err(); e != nil {
		return agentplugins.Operation{}, e
	}
	return s.agentPlugins.Begin(pluginOwner(meta), req)
}
func (s *Service) CommitAgentPlugin(meta *session.Meta, req agentplugins.CommitRequest) (agentplugins.Install, error) {
	if e := pluginAdmin(meta); e != nil {
		return agentplugins.Install{}, e
	}
	op, _ := s.agentPlugins.Operation(req.OperationID, pluginOwner(meta))
	old, _ := s.agentPlugins.Get(op.InstallID)
	in, e := s.agentPlugins.Commit(pluginOwner(meta), req)
	if e == nil {
		s.skillManager.Reload()
		for key, c := range old.Components {
			if c.CredentialRef != in.Components[key].CredentialRef {
				_ = s.mcpManager.pluginSecrets.DeleteAgentPluginCredential(c.CredentialRef)
			}
		}
	}
	return in, e
}
func (s *Service) AgentPluginOperation(meta *session.Meta, id string) (agentplugins.Operation, error) {
	if e := pluginAdmin(meta); e != nil {
		return agentplugins.Operation{}, e
	}
	return s.agentPlugins.Operation(id, pluginOwner(meta))
}
func (s *Service) ChangeAgentPlugin(meta *session.Meta, req agentplugins.Change) (agentplugins.Install, error) {
	if e := pluginAdmin(meta); e != nil {
		return agentplugins.Install{}, e
	}
	in, e := s.agentPlugins.Change(req)
	if e == nil {
		s.skillManager.Reload()
	}
	return in, e
}
func (s *Service) RemoveAgentPlugin(meta *session.Meta, id string, revision int64, deleteData bool) error {
	if e := pluginAdmin(meta); e != nil {
		return e
	}
	in, e := s.agentPlugins.Get(id)
	if e != nil {
		return e
	}
	if e = s.agentPlugins.Remove(id, revision, deleteData); e != nil {
		return e
	}
	s.skillManager.Reload()
	for _, c := range in.Components {
		if e = s.mcpManager.pluginSecrets.DeleteAgentPluginCredential(c.CredentialRef); e != nil {
			return e
		}
	}
	return nil
}
func (s *Service) CheckAgentPlugin(ctx context.Context, meta *session.Meta, id string, revision int64, key string) error {
	if e := pluginAdmin(meta); e != nil {
		return e
	}
	return s.mcpManager.checkPlugin(ctx, id, revision, key, session.AllowsProcessLaunch(meta))
}
func (s *Service) ConfigureAgentPlugin(meta *session.Meta, id string, revision int64, key string, values map[string]string) (agentplugins.Install, error) {
	if e := pluginAdmin(meta); e != nil {
		return agentplugins.Install{}, e
	}
	in, e := s.agentPlugins.Get(id)
	if e != nil {
		return in, e
	}
	if in.Revision != revision {
		return in, agentplugins.ErrConflict
	}
	config, ok := in.Package.MCP[strings.TrimPrefix(key, "mcp:")]
	if !ok || !strings.HasPrefix(key, "mcp:") {
		return in, agentplugins.ErrUnavailable
	}
	if e = validatePluginCredentials(config.Type, values); e != nil {
		return in, e
	}
	if values == nil {
		return in, nil
	}
	ref := ""
	if len(values) > 0 {
		ref, e = s.mcpManager.pluginSecrets.PutAgentPluginCredential(values)
		if e != nil {
			return in, e
		}
	}
	keys := []string{}
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	next, e := s.agentPlugins.BindCredential(id, revision, key, ref, keys)
	if e != nil {
		_ = s.mcpManager.pluginSecrets.DeleteAgentPluginCredential(ref)
		return in, e
	}
	_ = s.mcpManager.pluginSecrets.DeleteAgentPluginCredential(in.Components[key].CredentialRef)
	return next, nil
}
func (s *Service) AddAgentPluginSource(ctx context.Context, meta *session.Meta, url string, revision int64) (agentplugins.CatalogSource, error) {
	if e := pluginAdmin(meta); e != nil {
		return agentplugins.CatalogSource{}, e
	}
	return s.agentPlugins.AddSource(ctx, url, revision)
}
func (s *Service) RemoveAgentPluginSource(meta *session.Meta, id string, revision int64) error {
	if e := pluginAdmin(meta); e != nil {
		return e
	}
	return s.agentPlugins.RemoveSource(id, revision)
}
func (s *Service) AgentPluginCatalog(ctx context.Context, meta *session.Meta, id string) (agentplugins.Catalog, error) {
	if meta == nil || !meta.CanRead {
		return agentplugins.Catalog{}, errors.New("read_permission_required")
	}
	return s.agentPlugins.ReadCatalog(ctx, id)
}
