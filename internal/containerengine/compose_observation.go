package containerengine

import (
	"context"
	"errors"
	"sort"
	"strings"
)

var (
	ErrComposeProjectNotFound          = errors.New("compose project was not found")
	ErrComposeConfigurationUnavailable = errors.New("compose configuration is unavailable")
)

// Select labels individually so arbitrary label values and file paths never enter the observation.
const composeObservationFormat = `{"ID":{{json .ID}},"Name":{{json .Names}},"Project":{{json (.Label "com.docker.compose.project")}},"Service":{{json (.Label "com.docker.compose.service")}},"State":{{json .State}},"Status":{{json .Status}}}`

func (c *CLIClient) observeComposeProjects(ctx context.Context) ([]ComposeProjectDetails, error) {
	raw, err := c.run(ctx, EngineDocker, "ps", "-a", "--no-trunc", "--filter", "label=com.docker.compose.project", "--format", composeObservationFormat)
	if err != nil {
		return nil, err
	}
	type row struct {
		ID, Name, Project, Service, State, Status string
	}
	rows, err := decodeJSONLinesOrArray[row](raw)
	if err != nil {
		return nil, errors.New("docker Compose container observation is invalid")
	}
	groups := make(map[string][]ComposeProjectContainer)
	seen := make(map[string]struct{}, len(rows))
	for _, item := range rows {
		name, id := strings.TrimSpace(item.Project), strings.TrimSpace(item.ID)
		if invalidWorkspaceIdentity(name) || id == "" {
			return nil, errors.New("docker Compose container identity is invalid")
		}
		if _, duplicate := seen[id]; duplicate {
			return nil, errors.New("docker Compose container identity is duplicated")
		}
		seen[id] = struct{}{}
		state := ContainerState(strings.ToLower(strings.TrimSpace(item.State)))
		switch state {
		case ContainerStateRunning, ContainerStatePaused, ContainerStateCreated, ContainerStateExited, ContainerStateStopped, ContainerStateRestarting, "dead", "removing":
		default:
			state = ContainerStateUnknown
		}
		groups[name] = append(groups[name], ComposeProjectContainer{
			ContainerID: id, Name: strings.TrimSpace(item.Name), Service: strings.TrimSpace(item.Service),
			State: state, Health: listHealth(item.Status),
		})
	}
	projects := make([]ComposeProjectDetails, 0, len(groups))
	for name, members := range groups {
		projects = append(projects, summarizeComposeProject(name, members))
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].Name < projects[j].Name })
	return projects, nil
}

func summarizeComposeProject(name string, members []ComposeProjectContainer) ComposeProjectDetails {
	sort.Slice(members, func(i, j int) bool {
		if members[i].Name == members[j].Name {
			return members[i].ContainerID < members[j].ContainerID
		}
		return members[i].Name < members[j].Name
	})
	if members == nil {
		members = []ComposeProjectContainer{}
	}
	project := ComposeProject{ProjectID: ComposeProjectID(name), Name: name, ContainerCount: len(members), Status: "stopped"}
	services := make(map[string]struct{})
	paused, stopped, unknown := 0, 0, false
	for _, member := range members {
		if member.Service != "" {
			services[member.Service] = struct{}{}
		}
		switch member.State {
		case ContainerStateRunning:
			project.RunningCount++
		case ContainerStatePaused:
			paused++
		case ContainerStateCreated, ContainerStateExited, ContainerStateStopped, "dead":
			stopped++
		case ContainerStateRestarting, "removing":
		default:
			unknown = true
		}
	}
	project.ServiceCount = len(services)
	switch {
	case unknown:
		project.Status = "unknown"
	case len(members) == 0 || stopped == len(members):
		project.Status = "stopped"
	case project.RunningCount == len(members):
		project.Status = "running"
	case paused == len(members):
		project.Status = "paused"
	default:
		project.Status = "degraded"
	}
	return ComposeProjectDetails{ComposeProject: project, Containers: members}
}
