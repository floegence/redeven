package codeapp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/containerresource"
	"github.com/floegence/redeven/internal/hostnetwork"
	"github.com/floegence/redeven/internal/session"
)

type automationExecutor struct {
	provider   *aiReadinessController
	store      *automation.Store
	configPath string
	containers *containerresource.Service
}

func automationAuthority(store *automation.Store, configPath string) func(context.Context, automation.Owner, automation.Run) (*session.Meta, error) {
	return func(ctx context.Context, o automation.Owner, r automation.Run) (*session.Meta, error) {
		if err := store.ValidatePluginAuthority(ctx, o, r.WorkflowID); err != nil {
			return nil, err
		}
		g, err := store.GrantVersion(ctx, o, r.WorkflowID, r.DefinitionVersion)
		if err != nil {
			return nil, err
		}
		if !g.Enabled || g.Revision != r.DefinitionVersion || !g.ExpiresAt.After(time.Now()) || g.Model != r.Definition.Model || g.WorkingDirectory != r.Definition.WorkingDirectory {
			return nil, automation.ErrUnauthorized
		}
		cfg, err := config.Load(configPath)
		if err != nil || cfg == nil || cfg.LocalEnvironmentPublicID != o.Environment {
			return nil, automation.ErrUnauthorized
		}
		cap := cfg.PermissionPolicy.ResolveCap(o.User, g.Authority.App)
		if !g.Authority.Read || !g.Authority.Write || !g.Authority.Execute || !cap.Read || !cap.Write || !cap.Execute || g.Authority.Namespace == "" {
			return nil, automation.ErrUnauthorized
		}
		// This principal is minted from an explicit scoped delegation. No browser
		// bearer, admin bit, desktop authority, or platform model token is retained.
		return &session.Meta{UserPublicID: o.User, EndpointID: o.Environment, NamespacePublicID: g.Authority.Namespace, FloeApp: g.Authority.App, SessionKind: "automation", CanRead: true, CanWrite: true, CanExecute: true}, nil
	}
}
func (x *automationExecutor) Authorize(ctx context.Context, o automation.Owner, r automation.Run) error {
	_, err := automationAuthority(x.store, x.configPath)(ctx, o, r)
	return err
}
func (x *automationExecutor) Start(ctx context.Context, o automation.Owner, r automation.Run, a automation.Attempt) (string, error) {
	s, c, _, release, err := x.provider.AcquireAIService(ctx)
	if release != nil {
		defer release()
	}
	if err != nil {
		return "", err
	}
	return (ai.AutomationExecutor{Service: s}).Start(c, o, r, a)
}
func (x *automationExecutor) Inspect(ctx context.Context, o automation.Owner, r automation.Run, a automation.Attempt) (automation.ExecutionStatus, error) {
	for _, n := range r.Definition.Nodes {
		if n.ID == a.NodeID && n.Kind == "tool" {
			return automation.ExecutionStatus{Terminal: true, Outcome: "interrupted_read"}, nil
		}
	}
	s, c, _, release, err := x.provider.AcquireAIService(ctx)
	if release != nil {
		defer release()
	}
	if err != nil {
		return automation.ExecutionStatus{}, err
	}
	return (ai.AutomationExecutor{Service: s}).Inspect(c, o, r, a)
}
func (x *automationExecutor) Cancel(ctx context.Context, o automation.Owner, a automation.Attempt) error {
	s, c, _, release, err := x.provider.AcquireAIService(ctx)
	if release != nil {
		defer release()
	}
	if err != nil {
		return err
	}
	return (ai.AutomationExecutor{Service: s}).Cancel(c, o, a)
}
func (x *automationExecutor) Tool(ctx context.Context, o automation.Owner, r automation.Run, a automation.Attempt, n automation.Node) (data json.RawMessage, err error) {
	defer func() {
		if err != nil {
			err = &automation.ToolFailure{Cause: err, ConfirmedReadOnly: true}
		}
	}()
	if err = x.Authorize(ctx, o, r); err != nil {
		return nil, err
	}
	var value any
	switch n.Tool {
	case "http_get":
		var input struct {
			URL string `json:"url"`
		}
		if err = json.Unmarshal(n.Parameters, &input); err != nil {
			return nil, err
		}
		u, e := url.Parse(input.URL)
		if e != nil || u.Scheme != "https" && u.Scheme != "http" || u.Host == "" || u.User != nil {
			return nil, automation.ErrInvalid
		}
		transport := hostnetwork.NewTransport(nil)
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport, Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		request, e := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if e != nil {
			return nil, e
		}
		request.Header.Set("Accept-Encoding", "identity")
		response, e := client.Do(request)
		if e != nil {
			return nil, e
		}
		defer response.Body.Close()
		body, e := io.ReadAll(io.LimitReader(response.Body, 49153))
		if e != nil {
			return nil, e
		}
		if len(body) > 49152 {
			return nil, errors.New("response exceeds 48 KiB")
		}
		value = map[string]any{"url": u.String(), "status": response.StatusCode, "content_type": response.Header.Get("Content-Type"), "body": string(body), "observed_at": time.Now().UTC()}
	case "containers_list":
		var input containerengine.ContainerListRequest
		if err = json.Unmarshal(n.Parameters, &input); err != nil {
			return nil, err
		}
		value, err = x.containers.Containers(ctx, input)
	case "container_inspect":
		var input containerengine.ContainerInspectRequest
		if err = json.Unmarshal(n.Parameters, &input); err != nil {
			return nil, err
		}
		value, err = x.containers.Container(ctx, input)
	default:
		return nil, automation.ErrInvalid
	}
	if err != nil {
		return nil, err
	}
	data, err = json.Marshal(value)
	if err == nil && len(data) > 65536 {
		return nil, errors.New("tool result exceeds 64 KiB")
	}
	return data, err
}
