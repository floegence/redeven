package containerresource

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

const (
	maxComposeConfigBytes = 4 * 1024 * 1024
	maxComposeEnvBytes    = 1 * 1024 * 1024
)

var savedComposeNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

func (s *Service) CreateComposeProjectDefinition(ctx context.Context, input ComposeProjectDefinitionInput) (ComposeProjectDefinition, error) {
	definition, deployment, err := s.prepareComposeProjectDefinition(ctx, input)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	definition.ProjectID = newID("compose_saved")
	now := time.Now().UnixMilli()
	definition.CreatedAtUnixMs, definition.UpdatedAtUnixMs = now, now
	bound, _, err := s.engine.BindEndpoint(ctx, definition.Engine, definition.EndpointID)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	if err := s.engine.ValidateComposeDeployment(bound, deployment); err != nil {
		return ComposeProjectDefinition{}, fmt.Errorf("%w: Docker Compose could not validate this project", ErrInvalidRequest)
	}
	return s.store.createComposeProjectDefinition(ctx, definition)
}

func (s *Service) UpdateComposeProjectDefinition(ctx context.Context, projectID string, input ComposeProjectDefinitionInput) (ComposeProjectDefinition, error) {
	projectID = strings.TrimSpace(projectID)
	current, err := s.store.composeProjectDefinition(ctx, projectID)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	definition, deployment, err := s.prepareComposeProjectDefinition(ctx, input)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	if definition.Engine != current.Engine || definition.EndpointID != current.EndpointID {
		return ComposeProjectDefinition{}, fmt.Errorf("%w: a saved Compose project cannot move between container services", ErrInvalidRequest)
	}
	definition.ProjectID = current.ProjectID
	definition.CreatedAtUnixMs = current.CreatedAtUnixMs
	definition.UpdatedAtUnixMs = time.Now().UnixMilli()
	bound, _, err := s.engine.BindEndpoint(ctx, definition.Engine, definition.EndpointID)
	if err != nil {
		return ComposeProjectDefinition{}, err
	}
	if err := s.engine.ValidateComposeDeployment(bound, deployment); err != nil {
		return ComposeProjectDefinition{}, fmt.Errorf("%w: Docker Compose could not validate this project", ErrInvalidRequest)
	}
	return s.store.updateComposeProjectDefinition(ctx, definition)
}

func (s *Service) ComposeProjectDefinition(ctx context.Context, projectID string) (ComposeProjectDefinition, error) {
	return s.store.composeProjectDefinition(ctx, strings.TrimSpace(projectID))
}

func (s *Service) DeleteComposeProjectDefinition(ctx context.Context, projectID string) error {
	return s.store.deleteComposeProjectDefinition(ctx, strings.TrimSpace(projectID))
}

func (s *Service) prepareComposeProjectDefinition(ctx context.Context, input ComposeProjectDefinitionInput) (ComposeProjectDefinition, containerengine.ComposeDeploymentRequest, error) {
	if input.Engine != containerengine.EngineDocker {
		return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, containerengine.ErrResourceCapabilityUnsupported
	}
	name := strings.ToLower(strings.TrimSpace(input.Name))
	if !savedComposeNamePattern.MatchString(name) {
		return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, fmt.Errorf("%w: Compose project name is invalid", ErrInvalidRequest)
	}
	if len(input.ConfigPaths) == 0 || len(input.ConfigPaths) > 8 {
		return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, fmt.Errorf("%w: choose between one and eight Compose files", ErrInvalidRequest)
	}
	paths := make([]string, 0, len(input.ConfigPaths))
	seen := make(map[string]struct{}, len(input.ConfigPaths))
	for _, raw := range input.ConfigPaths {
		path, err := canonicalComposeFile(raw, maxComposeConfigBytes)
		if err != nil {
			return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
	}
	envFile := ""
	if strings.TrimSpace(input.EnvFilePath) != "" {
		var err error
		envFile, err = canonicalComposeFile(input.EnvFilePath, maxComposeEnvBytes)
		if err != nil {
			return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
	}
	profiles := make([]string, 0, len(input.Profiles))
	profileSeen := make(map[string]struct{}, len(input.Profiles))
	if len(input.Profiles) > 16 {
		return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, fmt.Errorf("%w: too many Compose profiles", ErrInvalidRequest)
	}
	for _, raw := range input.Profiles {
		profile := strings.TrimSpace(raw)
		if profile == "" || len(profile) > 64 || strings.ContainsAny(profile, "\x00\r\n /\\") || strings.HasPrefix(profile, "-") {
			return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, fmt.Errorf("%w: Compose profile is invalid", ErrInvalidRequest)
		}
		if _, exists := profileSeen[profile]; exists {
			continue
		}
		profileSeen[profile] = struct{}{}
		profiles = append(profiles, profile)
	}
	management, err := s.management(ctx, input.Engine, input.EndpointID, ResourceComposeProject, containerengine.ComposeProjectID(name), nil)
	if err != nil {
		return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, err
	}
	if management.Managed {
		return ComposeProjectDefinition{}, containerengine.ComposeDeploymentRequest{}, &ManagedResourceError{Owner: *management.Owner}
	}
	definition := ComposeProjectDefinition{
		Engine: input.Engine, EndpointID: input.EndpointID, Name: name,
		ConfigPaths: paths, EnvFilePath: envFile, Profiles: profiles,
	}
	return definition, definitionDeployment(definition), nil
}

func canonicalComposeFile(raw string, maxBytes int64) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" || !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") {
		return "", errors.New("Compose file path must be absolute")
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return "", errors.New("Compose file does not exist")
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("Compose file must be a regular file")
	}
	if info.Size() > maxBytes {
		return "", errors.New("Compose file exceeds the size limit")
	}
	return resolved, nil
}

func definitionDeployment(definition ComposeProjectDefinition) containerengine.ComposeDeploymentRequest {
	return containerengine.ComposeDeploymentRequest{
		ConfigPaths: append([]string(nil), definition.ConfigPaths...),
		EnvFilePath: definition.EnvFilePath,
		ProjectName: definition.Name,
		Profiles:    append([]string(nil), definition.Profiles...),
	}
}

func (s *Service) hydrateSavedComposeRequest(ctx context.Context, request *containerengine.ComposeProjectRequest) error {
	if request == nil || !strings.HasPrefix(strings.TrimSpace(request.ProjectID), "compose_saved_") {
		return nil
	}
	definition, err := s.store.composeProjectDefinition(ctx, strings.TrimSpace(request.ProjectID))
	if err != nil {
		return err
	}
	if definition.Engine != request.Engine || definition.EndpointID != request.EndpointID {
		return ErrComposeProjectDefinitionNotFound
	}
	deployment := definitionDeployment(definition)
	request.Deployment = &deployment
	request.DefinitionRevision = strconv.FormatInt(definition.UpdatedAtUnixMs, 10)
	return nil
}
