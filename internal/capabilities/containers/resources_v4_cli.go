package containers

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type endpointContextKey struct{}

type boundEngineEndpoint struct {
	engine        Engine
	endpointID    EndpointID
	name          string
	useConnection bool
}

func (c *CLIClient) BindEndpoint(ctx context.Context, engine Engine, endpointID EndpointID) (context.Context, EngineEndpoint, error) {
	if err := validateEngine(engine); err != nil {
		return nil, EngineEndpoint{}, err
	}
	items, err := c.ListEndpoints(ctx, engine)
	if err != nil {
		return nil, EngineEndpoint{}, err
	}
	requested := strings.TrimSpace(string(endpointID))
	for _, item := range items {
		if requested == string(item.EndpointID) || (requested == "" && item.Default) {
			bound := boundEngineEndpoint{
				engine:        engine,
				endpointID:    item.EndpointID,
				name:          item.DisplayName,
				useConnection: engine == EngineDocker || item.Remote,
			}
			return context.WithValue(ctx, endpointContextKey{}, bound), item, nil
		}
	}
	return nil, EngineEndpoint{}, ErrEndpointNotFound
}

func (c *CLIClient) ListEndpoints(ctx context.Context, engine Engine) ([]EngineEndpoint, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	if engine == EngineDocker {
		return c.listDockerContexts(ctx)
	}
	return c.listPodmanConnections(ctx)
}

func (c *CLIClient) EndpointMetadata(ctx context.Context, endpoint EngineEndpoint) (EngineEndpoint, error) {
	status, err := c.Status(ctx, endpoint.Engine)
	endpoint.Available = err == nil && status.Available
	endpoint.EngineVersion = strings.TrimSpace(status.Version)
	if err != nil || endpoint.Engine != EnginePodman {
		return endpoint, err
	}
	raw, err := c.run(ctx, EnginePodman, "info", "--format", "json")
	if err != nil {
		return endpoint, err
	}
	var info struct {
		Host struct {
			Security struct {
				Rootless bool `json:"rootless"`
			} `json:"security"`
		} `json:"host"`
	}
	if err := json.Unmarshal(raw, &info); err != nil {
		return endpoint, errors.New("Podman endpoint metadata is invalid")
	}
	rootless := info.Host.Security.Rootless
	endpoint.Rootless = &rootless
	return endpoint, nil
}

func (c *CLIClient) listDockerContexts(ctx context.Context) ([]EngineEndpoint, error) {
	raw, err := c.run(ctx, EngineDocker, "context", "ls", "--format", "{{json .}}")
	if err != nil {
		return nil, err
	}
	type row struct {
		Name    string `json:"Name"`
		Current bool   `json:"Current"`
	}
	rows, err := decodeJSONLinesOrArray[row](raw)
	if err != nil {
		return nil, errors.New("Docker context inventory is invalid")
	}
	out := make([]EngineEndpoint, 0, len(rows))
	for _, item := range rows {
		name := strings.TrimSpace(item.Name)
		if invalidEndpointName(name) {
			continue
		}
		out = append(out, EngineEndpoint{EndpointID: endpointID(EngineDocker, name), Engine: EngineDocker, DisplayName: name, Default: item.Current, Remote: name != "default"})
	}
	if len(out) == 0 {
		out = append(out, EngineEndpoint{EndpointID: endpointID(EngineDocker, "default"), Engine: EngineDocker, DisplayName: "default", Default: true})
	}
	ensureDefaultEndpoint(out)
	return out, nil
}

func (c *CLIClient) listPodmanConnections(ctx context.Context) ([]EngineEndpoint, error) {
	type row struct {
		Name      string `json:"Name"`
		Default   bool   `json:"Default"`
		ReadWrite bool   `json:"ReadWrite"`
	}
	raw, err := c.run(ctx, EnginePodman, "system", "connection", "list", "--format", "json")
	if err != nil && !errors.Is(err, ErrBackendUnreachable) && !errors.Is(err, ErrDaemonStopped) {
		return nil, err
	}
	rows := []row{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if decodeErr := json.Unmarshal(raw, &rows); decodeErr != nil {
			return nil, errors.New("Podman connection inventory is invalid")
		}
	}
	out := []EngineEndpoint{{EndpointID: endpointID(EnginePodman, "local:"), Engine: EnginePodman, DisplayName: "local", Default: len(rows) == 0, Remote: false}}
	for _, item := range rows {
		name := strings.TrimSpace(item.Name)
		if invalidEndpointName(name) {
			continue
		}
		out = append(out, EngineEndpoint{EndpointID: endpointID(EnginePodman, "connection:"+name), Engine: EnginePodman, DisplayName: name, Default: item.Default, Remote: true})
	}
	ensureDefaultEndpoint(out)
	return out, nil
}

func (c *CLIClient) ListComposeProjects(ctx context.Context) ([]ComposeProject, error) {
	if !boundForEngine(ctx, EngineDocker) {
		return nil, ErrEndpointNotFound
	}
	rows, err := c.composeProjectRows(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ComposeProject, 0, len(rows))
	for _, item := range rows {
		name := strings.TrimSpace(item.Name)
		if invalidWorkspaceIdentity(name) {
			continue
		}
		project := ComposeProject{ProjectID: composeProjectID(name), Name: name, Status: normalizeProjectStatus(item.Status)}
		if details, detailErr := c.inspectComposeProjectRow(ctx, item); detailErr == nil {
			project.ServiceCount = details.ServiceCount
			project.ContainerCount = details.ContainerCount
			project.RunningCount = details.RunningCount
		}
		out = append(out, project)
	}
	return out, nil
}

func (c *CLIClient) InspectComposeProject(ctx context.Context, projectID string) (ComposeProjectDetails, error) {
	row, err := c.resolveComposeProject(ctx, projectID)
	if err != nil {
		return ComposeProjectDetails{}, err
	}
	return c.inspectComposeProjectRow(ctx, row)
}

func (c *CLIClient) ComposeProjectAction(ctx context.Context, method Method, projectID string) error {
	row, err := c.resolveComposeProject(ctx, projectID)
	if err != nil {
		return err
	}
	action := ""
	switch method {
	case MethodComposeProjectsStart:
		action = "start"
	case MethodComposeProjectsStop:
		action = "stop"
	case MethodComposeProjectsRestart:
		action = "restart"
	case MethodComposeProjectsDown:
		action = "down"
	default:
		return fmt.Errorf("%w: %q", ErrInvalidMethod, method)
	}
	args, err := composeArgs(row)
	if err != nil {
		return err
	}
	_, err = c.run(ctx, EngineDocker, append(args, action)...)
	return err
}

func (c *CLIClient) ListPods(ctx context.Context) ([]PodRecord, error) {
	if !boundForEngine(ctx, EnginePodman) {
		return nil, ErrEndpointNotFound
	}
	raw, err := c.run(ctx, EnginePodman, "pod", "ps", "--format", "json")
	if err != nil {
		return nil, err
	}
	type row struct {
		ID                 string `json:"Id"`
		Name               string `json:"Name"`
		Status             string `json:"Status"`
		InfraID            string `json:"InfraId"`
		NumberOfContainers int    `json:"NumberOfContainers"`
		Created            string `json:"Created"`
	}
	rows := []row{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, errors.New("Podman Pod inventory is invalid")
		}
	}
	identities := make([]string, 0, len(rows))
	for _, item := range rows {
		id := strings.TrimSpace(item.ID)
		name := strings.TrimSpace(item.Name)
		if invalidWorkspaceIdentity(id) || invalidWorkspaceIdentity(name) {
			continue
		}
		identities = append(identities, id)
	}
	return c.inspectPodRecords(ctx, identities)
}

func (c *CLIClient) InspectPod(ctx context.Context, podID string) (PodRecord, error) {
	if invalidWorkspaceIdentity(podID) || !boundForEngine(ctx, EnginePodman) {
		return PodRecord{}, errors.New("Pod identity is invalid")
	}
	raw, err := c.run(ctx, EnginePodman, "pod", "inspect", strings.TrimSpace(podID))
	if err != nil {
		return PodRecord{}, err
	}
	rows, err := decodePodInspect(raw)
	if err != nil || len(rows) != 1 {
		return PodRecord{}, errors.New("Podman Pod inspection is invalid")
	}
	return rows[0], nil
}

const podInspectBatchSize = 32

func (c *CLIClient) inspectPodRecords(ctx context.Context, identities []string) ([]PodRecord, error) {
	if len(identities) == 0 {
		return []PodRecord{}, nil
	}
	out := make([]PodRecord, 0, len(identities))
	for start := 0; start < len(identities); start += podInspectBatchSize {
		end := min(start+podInspectBatchSize, len(identities))
		args := append([]string{"pod", "inspect"}, identities[start:end]...)
		raw, err := c.run(ctx, EnginePodman, args...)
		if err != nil {
			return nil, err
		}
		rows, err := decodePodInspect(raw)
		if err != nil || len(rows) != end-start {
			return nil, errors.New("Podman Pod inspection is invalid")
		}
		out = append(out, rows...)
	}
	return out, nil
}

type podInspectContainer struct {
	ID    string `json:"Id"`
	Name  string `json:"Name"`
	State string `json:"State"`
	Infra bool   `json:"Infra"`
}

type podInspectDocument struct {
	ID          string                `json:"Id"`
	Name        string                `json:"Name"`
	State       string                `json:"State"`
	InfraID     string                `json:"InfraContainerID"`
	Created     string                `json:"Created"`
	Containers  []podInspectContainer `json:"Containers"`
	InfraConfig struct {
		PortBindings map[string][]inspectPortBinding `json:"PortBindings"`
	} `json:"InfraConfig"`
}

func decodePodInspect(raw []byte) ([]PodRecord, error) {
	documents := []podInspectDocument{}
	if err := json.Unmarshal(raw, &documents); err != nil {
		return nil, err
	}
	out := make([]PodRecord, 0, len(documents))
	for _, item := range documents {
		podID := strings.TrimSpace(item.ID)
		name := strings.TrimSpace(item.Name)
		if invalidWorkspaceIdentity(podID) || invalidWorkspaceIdentity(name) {
			return nil, errors.New("Podman Pod inspection contains an invalid identity")
		}
		pod := PodRecord{
			PodID:           podID,
			Name:            name,
			Status:          normalizePodStatus(item.State),
			InfraID:         strings.TrimSpace(item.InfraID),
			ContainerCount:  len(item.Containers),
			CreatedAtUnixMs: parseFlexibleTime(item.Created),
			Ports:           inspectPortSummaries(item.InfraConfig.PortBindings),
		}
		for _, child := range item.Containers {
			state := normalizeStateString(child.State)
			if state == ContainerStateRunning {
				pod.RunningCount++
			}
			pod.Containers = append(pod.Containers, PodContainer{ContainerID: strings.TrimSpace(child.ID), Name: strings.TrimSpace(child.Name), State: state, Infra: child.Infra})
		}
		out = append(out, pod)
	}
	return out, nil
}

func (c *CLIClient) CreatePod(ctx context.Context, req PodCreateRequest) (PodRecord, error) {
	raw, err := c.run(ctx, EnginePodman, "pod", "create", "--name", strings.TrimSpace(req.Name))
	if err != nil {
		return PodRecord{}, err
	}
	id := strings.TrimSpace(string(raw))
	if invalidWorkspaceIdentity(id) {
		return PodRecord{}, errors.New("Podman returned an invalid Pod identity")
	}
	return c.InspectPod(ctx, id)
}

func (c *CLIClient) PodAction(ctx context.Context, method Method, podID string) error {
	action := ""
	switch method {
	case MethodPodsStart:
		action = "start"
	case MethodPodsStop:
		action = "stop"
	case MethodPodsRestart:
		action = "restart"
	case MethodPodsRemove:
		action = "rm"
	default:
		return fmt.Errorf("%w: %q", ErrInvalidMethod, method)
	}
	_, err := c.run(ctx, EnginePodman, "pod", action, strings.TrimSpace(podID))
	return err
}

type composeProjectRow struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
}

func (c *CLIClient) composeProjectRows(ctx context.Context) ([]composeProjectRow, error) {
	raw, err := c.run(ctx, EngineDocker, "compose", "ls", "--all", "--format", "json")
	if err != nil {
		return nil, err
	}
	rows := []composeProjectRow{}
	if len(bytes.TrimSpace(raw)) == 0 {
		return rows, nil
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, errors.New("Docker Compose project inventory is invalid")
	}
	return rows, nil
}

func (c *CLIClient) resolveComposeProject(ctx context.Context, projectID string) (composeProjectRow, error) {
	rows, err := c.composeProjectRows(ctx)
	if err != nil {
		return composeProjectRow{}, err
	}
	for _, item := range rows {
		if composeProjectID(item.Name) == strings.TrimSpace(projectID) {
			return item, nil
		}
	}
	return composeProjectRow{}, ErrEndpointNotFound
}

func (c *CLIClient) inspectComposeProjectRow(ctx context.Context, row composeProjectRow) (ComposeProjectDetails, error) {
	args, err := composeArgs(row)
	if err != nil {
		return ComposeProjectDetails{}, err
	}
	raw, err := c.run(ctx, EngineDocker, append(args, "ps", "--all", "--format", "json")...)
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
		return ComposeProjectDetails{}, errors.New("Docker Compose project inspection is invalid")
	}
	project := ComposeProject{ProjectID: composeProjectID(row.Name), Name: strings.TrimSpace(row.Name), Status: normalizeProjectStatus(row.Status), ContainerCount: len(items)}
	services := map[string]struct{}{}
	containers := make([]ComposeProjectContainer, 0, len(items))
	for _, child := range items {
		state := normalizeStateString(child.State)
		if state == ContainerStateRunning {
			project.RunningCount++
		}
		if service := strings.TrimSpace(child.Service); service != "" {
			services[service] = struct{}{}
		}
		containers = append(containers, ComposeProjectContainer{ContainerID: strings.TrimSpace(child.ID), Name: strings.TrimSpace(child.Name), Service: strings.TrimSpace(child.Service), State: state, Health: normalizeHealth(child.Health)})
	}
	project.ServiceCount = len(services)
	return ComposeProjectDetails{ComposeProject: project, Containers: containers}, nil
}

func composeArgs(row composeProjectRow) ([]string, error) {
	name := strings.TrimSpace(row.Name)
	if invalidWorkspaceIdentity(name) {
		return nil, errors.New("Compose project identity is invalid")
	}
	args := []string{"compose"}
	files := strings.Split(row.ConfigFiles, ",")
	if len(files) > 32 {
		return nil, errors.New("Compose project configuration exceeds resource limits")
	}
	for _, raw := range files {
		path := strings.TrimSpace(raw)
		if path == "" || hasControl(path) || strings.HasPrefix(path, "-") {
			return nil, errors.New("Compose project configuration is invalid")
		}
		args = append(args, "--file", path)
	}
	return append(args, "--project-name", name), nil
}

func endpointArgs(ctx context.Context, engine Engine, args []string) []string {
	bound, _ := ctx.Value(endpointContextKey{}).(boundEngineEndpoint)
	if bound.engine != engine || !bound.useConnection || strings.TrimSpace(bound.name) == "" {
		return args
	}
	prefix := []string{"--context", bound.name}
	if engine == EnginePodman {
		prefix = []string{"--connection", bound.name}
	}
	return append(prefix, args...)
}

func boundForEngine(ctx context.Context, engine Engine) bool {
	bound, ok := ctx.Value(endpointContextKey{}).(boundEngineEndpoint)
	return ok && bound.engine == engine
}

func endpointIDFromContext(ctx context.Context, engine Engine) EndpointID {
	bound, ok := ctx.Value(endpointContextKey{}).(boundEngineEndpoint)
	if !ok || bound.engine != engine || !bound.endpointID.Valid() {
		return ""
	}
	return bound.endpointID
}

func endpointID(engine Engine, name string) EndpointID {
	digest := sha256.Sum256([]byte(string(engine) + "\x00" + strings.TrimSpace(name)))
	return EndpointID("endpoint_" + hex.EncodeToString(digest[:]))
}

func composeProjectID(name string) string {
	digest := sha256.Sum256([]byte("docker-compose\x00" + strings.TrimSpace(name)))
	return "project_" + hex.EncodeToString(digest[:])
}

func invalidEndpointName(value string) bool {
	value = strings.TrimSpace(value)
	return value == "" || len(value) > 256 || strings.HasPrefix(value, "-") || hasControl(value)
}

func ensureDefaultEndpoint(items []EngineEndpoint) {
	for _, item := range items {
		if item.Default {
			return
		}
	}
	if len(items) > 0 {
		items[0].Default = true
	}
}

func decodeJSONLinesOrArray[T any](raw []byte) ([]T, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return []T{}, nil
	}
	if trimmed[0] == '[' {
		var items []T
		return items, json.Unmarshal(trimmed, &items)
	}
	items := []T{}
	scanner := bufio.NewScanner(bytes.NewReader(trimmed))
	for scanner.Scan() {
		var item T
		if err := json.Unmarshal(scanner.Bytes(), &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, scanner.Err()
}

func normalizeProjectStatus(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch {
	case strings.Contains(lower, "running"):
		return "running"
	case strings.Contains(lower, "exited"), strings.Contains(lower, "stopped"):
		return "stopped"
	case strings.Contains(lower, "partial"), strings.Contains(lower, "restarting"):
		return "degraded"
	default:
		return "unknown"
	}
}

func normalizePodStatus(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case "running", "degraded", "paused", "exited", "stopped", "created":
		return lower
	default:
		return "unknown"
	}
}

func normalizeHealth(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case "healthy", "unhealthy", "starting", "none":
		return lower
	default:
		return "unknown"
	}
}

func parseFlexibleTime(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if unix, err := strconv.ParseInt(value, 10, 64); err == nil {
		if unix > 1_000_000_000_000 {
			return unix
		}
		return unix * 1000
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UnixMilli()
		}
	}
	return 0
}

type containerGroupProjection struct {
	Kind string
	ID   string
	Name string
}

func listContainerGroup(engine Engine, raw json.RawMessage, podID, podName string) containerGroupProjection {
	labels := map[string]string{}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) > 0 && !bytes.Equal(trimmed, []byte("null")) {
		if trimmed[0] == '{' {
			_ = json.Unmarshal(trimmed, &labels)
		} else {
			var value string
			if json.Unmarshal(trimmed, &value) == nil {
				for _, part := range strings.Split(value, ",") {
					key, item, found := strings.Cut(part, "=")
					if found {
						labels[strings.TrimSpace(key)] = strings.TrimSpace(item)
					}
				}
			}
		}
	}
	return containerGroup(engine, labels, podID, podName)
}

func containerGroup(engine Engine, labels map[string]string, podID, podName string) containerGroupProjection {
	if engine == EngineDocker {
		name := strings.TrimSpace(labels["com.docker.compose.project"])
		if name != "" {
			return containerGroupProjection{Kind: "compose_project", ID: composeProjectID(name), Name: name}
		}
		return containerGroupProjection{}
	}
	id := strings.TrimSpace(podID)
	name := strings.TrimSpace(podName)
	if id == "" {
		id = strings.TrimSpace(labels["io.podman.pod.id"])
	}
	if name == "" {
		name = strings.TrimSpace(labels["io.podman.pod.name"])
	}
	if id == "" && name == "" {
		return containerGroupProjection{}
	}
	return containerGroupProjection{Kind: "pod", ID: id, Name: name}
}
