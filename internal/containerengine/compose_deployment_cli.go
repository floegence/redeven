package containerengine

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

func composeDeploymentArgs(req ComposeDeploymentRequest) []string {
	args := []string{"compose"}
	for _, path := range composeDeploymentConfigPaths(req) {
		args = append(args, "--file", strings.TrimSpace(path))
	}
	args = append(args, "--project-name", strings.TrimSpace(req.ProjectName))
	if envFile := strings.TrimSpace(req.EnvFilePath); envFile != "" {
		args = append(args, "--env-file", envFile)
	}
	for _, profile := range req.Profiles {
		args = append(args, "--profile", strings.TrimSpace(profile))
	}
	return args
}

func (c *CLIClient) ValidateComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return err
	}
	_, err := c.run(ctx, EngineDocker, append(composeDeploymentArgs(req), "config", "--quiet")...)
	return err
}

func (c *CLIClient) ApplyComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return err
	}
	_, err := c.run(ctx, EngineDocker, append(composeDeploymentArgs(req), "up", "--detach", "--remove-orphans")...)
	return err
}

func (c *CLIClient) CreateComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return err
	}
	_, err := c.run(ctx, EngineDocker, append(composeDeploymentArgs(req), "create", "--remove-orphans")...)
	return err
}

func (c *CLIClient) InspectComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) (ComposeProjectDetails, error) {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return ComposeProjectDetails{}, err
	}
	raw, err := c.run(ctx, EngineDocker, append(composeDeploymentArgs(req), "ps", "--all", "--no-trunc", "--format", "json")...)
	if err != nil {
		return ComposeProjectDetails{}, err
	}
	type item struct {
		ID      string `json:"ID"`
		Name    string `json:"Name"`
		Service string `json:"Service"`
		State   string `json:"State"`
		Health  string `json:"Health"`
	}
	items, err := decodeJSONLinesOrArray[item](raw)
	if err != nil {
		return ComposeProjectDetails{}, errors.New("Docker Compose deployment inspection is invalid")
	}
	project := ComposeProject{ProjectID: ComposeProjectID(req.ProjectName), Name: strings.TrimSpace(req.ProjectName), ContainerCount: len(items)}
	services := map[string]struct{}{}
	children := make([]ComposeProjectContainer, 0, len(items))
	for _, item := range items {
		state := normalizeStateString(item.State)
		if state == ContainerStateRunning {
			project.RunningCount++
		}
		services[item.Service] = struct{}{}
		children = append(children, ComposeProjectContainer{ContainerID: strings.TrimSpace(item.ID), Name: strings.TrimSpace(item.Name), Service: strings.TrimSpace(item.Service), State: state, Health: normalizeHealth(item.Health)})
	}
	project.ServiceCount = len(services)
	if project.RunningCount == project.ContainerCount && project.ContainerCount > 0 {
		project.Status = "running"
	} else if project.ContainerCount > 0 {
		project.Status = "stopped"
	}
	return ComposeProjectDetails{ComposeProject: project, Containers: children}, nil
}

func (c *CLIClient) StartComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	return c.runComposeDeploymentAction(ctx, req, "start", nil)
}

func (c *CLIClient) StopComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	return c.runComposeDeploymentAction(ctx, req, "stop", nil)
}

func (c *CLIClient) RestartComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) error {
	return c.runComposeDeploymentAction(ctx, req, "restart", nil)
}

func (c *CLIClient) RemoveComposeDeployment(ctx context.Context, req ComposeDeploymentRequest, removeVolumes bool) error {
	extra := []string(nil)
	if removeVolumes {
		extra = []string{"--volumes"}
	}
	return c.runComposeDeploymentAction(ctx, req, "down", extra)
}

func (c *CLIClient) runComposeDeploymentAction(ctx context.Context, req ComposeDeploymentRequest, action string, extra []string) error {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return err
	}
	args := append(composeDeploymentArgs(req), action)
	args = append(args, extra...)
	_, err := c.run(ctx, EngineDocker, args...)
	return err
}

func (c *CLIClient) TailComposeDeploymentLogs(ctx context.Context, req ComposeDeploymentRequest, tail int) ([]string, error) {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return nil, err
	}
	raw, err := c.run(ctx, EngineDocker, append(composeDeploymentArgs(req), "logs", "--no-color", "--tail", strconv.Itoa(tail))...)
	if err != nil {
		return nil, err
	}
	rows := strings.Split(strings.TrimRight(string(raw), "\r\n"), "\n")
	if len(rows) == 1 && rows[0] == "" {
		return []string{}, nil
	}
	return rows, nil
}
