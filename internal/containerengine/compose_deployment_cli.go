package containerengine

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"
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
	_, err := c.run(ctx, EngineDocker, append(composeDeploymentArgs(req), "create")...)
	return err
}

func (c *CLIClient) InspectComposeDeployment(ctx context.Context, req ComposeDeploymentRequest) (ComposeProjectDetails, error) {
	if err := validateComposeDeploymentRequest(req); err != nil {
		return ComposeProjectDetails{}, err
	}
	projects, err := c.observeComposeProjects(ctx)
	if err != nil {
		return ComposeProjectDetails{}, err
	}
	for _, project := range projects {
		if project.Name == strings.TrimSpace(req.ProjectName) {
			return project, nil
		}
	}
	return summarizeComposeProject(strings.TrimSpace(req.ProjectName), nil), nil
}

func validateComposeFiles(paths []string) error {
	for _, path := range paths {
		file, err := os.Open(strings.TrimSpace(path))
		if err != nil {
			return ErrComposeConfigurationUnavailable
		}
		info, err := file.Stat()
		file.Close()
		if err != nil || !info.Mode().IsRegular() {
			return ErrComposeConfigurationUnavailable
		}
	}
	return nil
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
	timeout := c.Timeout
	if (action == "stop" || action == "restart" || action == "down") && timeout < 30*time.Second {
		timeout = 30 * time.Second
	}
	_, err := c.runWithTimeout(ctx, timeout, EngineDocker, args...)
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
