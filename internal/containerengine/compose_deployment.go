package containerengine

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var composeDeploymentNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

type ComposeDeploymentRequest struct {
	ConfigPath  string
	EnvFilePath string
	ProjectName string
}

type ComposeDeploymentClient interface {
	ValidateComposeDeployment(context.Context, ComposeDeploymentRequest) error
	ApplyComposeDeployment(context.Context, ComposeDeploymentRequest) error
	InspectComposeDeployment(context.Context, ComposeDeploymentRequest) (ComposeProjectDetails, error)
	StartComposeDeployment(context.Context, ComposeDeploymentRequest) error
	StopComposeDeployment(context.Context, ComposeDeploymentRequest) error
	RemoveComposeDeployment(context.Context, ComposeDeploymentRequest, bool) error
	TailComposeDeploymentLogs(context.Context, ComposeDeploymentRequest, int) ([]string, error)
}

func validateComposeDeploymentRequest(req ComposeDeploymentRequest) error {
	if !composeDeploymentNamePattern.MatchString(strings.TrimSpace(req.ProjectName)) {
		return errors.New("compose project name is invalid")
	}
	for _, path := range []string{req.ConfigPath, req.EnvFilePath} {
		path = strings.TrimSpace(path)
		if path == "" || !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") {
			return errors.New("compose deployment path is invalid")
		}
	}
	return nil
}

func (a *Adapter) composeDeploymentClient() (ComposeDeploymentClient, error) {
	client, ok := a.client.(ComposeDeploymentClient)
	if !ok || client == nil {
		return nil, ErrResourceCapabilityUnsupported
	}
	return client, nil
}

func (a *Adapter) SupportsComposeDeployment() bool {
	if a == nil {
		return false
	}
	_, ok := a.client.(ComposeDeploymentClient)
	return ok
}

func (a *Adapter) ValidateComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return err
	}
	client, err := a.composeDeploymentClient()
	if err != nil {
		return err
	}
	return client.ValidateComposeDeployment(ctx, req)
}

func (a *Adapter) ApplyComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return err
	}
	client, err := a.composeDeploymentClient()
	if err != nil {
		return err
	}
	return client.ApplyComposeDeployment(ctx, req)
}

func (a *Adapter) InspectComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) (ComposeProjectDetails, error) {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return ComposeProjectDetails{}, err
	}
	client, err := a.composeDeploymentClient()
	if err != nil {
		return ComposeProjectDetails{}, err
	}
	return client.InspectComposeDeployment(ctx, req)
}

func (a *Adapter) StartComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	return a.composeDeploymentAction(ctx, req, func(client ComposeDeploymentClient) error { return client.StartComposeDeployment(ctx, req) })
}

func (a *Adapter) StopComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	return a.composeDeploymentAction(ctx, req, func(client ComposeDeploymentClient) error { return client.StopComposeDeployment(ctx, req) })
}

func (a *Adapter) RemoveComposeDeployment(ctx context.Context, req ComposeDeploymentRequest, removeVolumes bool) error {
	return a.composeDeploymentAction(ctx, req, func(client ComposeDeploymentClient) error {
		return client.RemoveComposeDeployment(ctx, req, removeVolumes)
	})
}

func (a *Adapter) composeDeploymentAction(_ context.Context, req ComposeDeploymentRequest, action func(ComposeDeploymentClient) error) error {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return err
	}
	client, err := a.composeDeploymentClient()
	if err != nil {
		return err
	}
	return action(client)
}

func (a *Adapter) TailComposeDeploymentLogs(ctx context.Context, req ComposeDeploymentRequest, tail int) ([]string, error) {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return nil, err
	}
	if tail < 1 || tail > maxLogTailLines {
		return nil, fmt.Errorf("compose log tail must be between 1 and %d", maxLogTailLines)
	}
	client, err := a.composeDeploymentClient()
	if err != nil {
		return nil, err
	}
	return client.TailComposeDeploymentLogs(ctx, req, tail)
}
