package containers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/processenv"
)

const (
	defaultCommandTimeout = 10 * time.Second
	defaultLogTailLines   = 100
	maxCommandOutputBytes = 8 * 1024 * 1024
	maxLogLineBytes       = 1024 * 1024
	maxLogTailLines       = 1000
)

type CommandRunner interface {
	Run(ctx context.Context, name string, args ...string) ([]byte, error)
}

type CommandStreamer interface {
	Stream(ctx context.Context, name string, args []string, onStdoutLine func([]byte) error) error
}

type CommandRunnerFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

func (f CommandRunnerFunc) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return f(ctx, name, args...)
}

type CLIClient struct {
	Runner        CommandRunner
	Timeout       time.Duration
	StreamTimeout time.Duration
}

func NewCLIClient() *CLIClient {
	return &CLIClient{Runner: execRunner{}, Timeout: defaultCommandTimeout}
}

func (c *CLIClient) Status(ctx context.Context, engine Engine) (EngineStatus, error) {
	if err := validateEngine(engine); err != nil {
		return EngineStatus{Engine: engine}, err
	}
	raw, err := c.run(ctx, engine, "version", "--format", "{{json .}}")
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) ||
			errors.Is(err, ErrCLIUnavailable) || errors.Is(err, ErrDaemonStopped) || errors.Is(err, ErrPermissionDenied) || errors.Is(err, ErrEngineTimeout) {
			return EngineStatus{Engine: engine}, err
		}
		return EngineStatus{Engine: engine}, fmt.Errorf("%w: %s", ErrBackendUnreachable, engine)
	}
	version := extractVersion(raw)
	return EngineStatus{Engine: engine, Available: true, Version: version}, nil
}

func (c *CLIClient) List(ctx context.Context, engine Engine, all bool) ([]EngineContainer, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	args := []string{"ps", "--no-trunc", "--format", "json"}
	if all {
		args = []string{"ps", "-a", "--no-trunc", "--format", "json"}
	}
	raw, err := c.run(ctx, engine, args...)
	if err != nil {
		return nil, err
	}
	return parseContainerList(engine, raw)
}

func (c *CLIClient) Inspect(ctx context.Context, engine Engine, containerID string) (EngineContainer, error) {
	if err := validateEngine(engine); err != nil {
		return EngineContainer{}, err
	}
	containerID = strings.TrimSpace(containerID)
	if err := validateContainerIdentifier(containerID); err != nil {
		return EngineContainer{}, err
	}
	raw, err := c.run(ctx, engine, "inspect", containerID)
	if err != nil {
		return EngineContainer{}, err
	}
	return parseContainerInspect(engine, raw)
}

func (c *CLIClient) Action(ctx context.Context, req EngineActionRequest) (EngineActionResult, error) {
	if err := validateAction(req); err != nil {
		return EngineActionResult{}, err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	args := actionArgs(req.Method, containerID, req.Force, req.TimeoutSec)
	if _, err := c.run(ctx, req.Engine, args...); err != nil {
		return EngineActionResult{}, err
	}
	return EngineActionResult{
		Engine:      req.Engine,
		Method:      req.Method,
		ContainerID: containerID,
		Completed:   true,
	}, nil
}

func (c *CLIClient) TailLogs(ctx context.Context, req EngineLogsRequest) (EngineLogsResult, error) {
	if err := validateEngine(req.Engine); err != nil {
		return EngineLogsResult{}, err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if err := validateContainerIdentifier(containerID); err != nil {
		return EngineLogsResult{}, err
	}
	if req.Follow {
		return EngineLogsResult{}, ErrLogsFollowUnsupported
	}
	tailLines, err := normalizeTailLines(req.TailLines)
	if err != nil {
		return EngineLogsResult{}, err
	}
	args := []string{"logs", "--timestamps", "--tail", strconv.Itoa(tailLines)}
	if req.SinceUnixMs > 0 {
		args = append(args, "--since", time.UnixMilli(req.SinceUnixMs).UTC().Format(time.RFC3339Nano))
	}
	args = append(args, containerID)
	raw, err := c.run(ctx, req.Engine, args...)
	if err != nil {
		return EngineLogsResult{}, err
	}
	return EngineLogsResult{
		Engine:      req.Engine,
		ContainerID: containerID,
		Lines:       parseLogLines(raw),
	}, nil
}

func (c *CLIClient) FollowLogs(ctx context.Context, req EngineLogsRequest, sink LogLineSink) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if err := validateContainerIdentifier(containerID); err != nil {
		return err
	}
	if sink == nil {
		return errors.New("logs stream sink is required")
	}
	if !req.Follow {
		return errors.New("follow is required for logs stream")
	}
	tailLines, err := normalizeTailLines(req.TailLines)
	if err != nil {
		return err
	}
	args := []string{"logs", "--follow", "--timestamps", "--tail", strconv.Itoa(tailLines)}
	if req.SinceUnixMs > 0 {
		args = append(args, "--since", time.UnixMilli(req.SinceUnixMs).UTC().Format(time.RFC3339Nano))
	}
	args = append(args, containerID)
	return c.stream(ctx, req.Engine, args, func(streamCtx context.Context, raw []byte) error {
		for _, line := range parseLogLines(raw) {
			if err := sink.AppendLogLine(streamCtx, line); err != nil {
				return err
			}
		}
		return nil
	})
}

func (c *CLIClient) PullImage(ctx context.Context, engine Engine, imageRef string) (EngineImageResult, error) {
	if err := validateEngine(engine); err != nil {
		return EngineImageResult{}, err
	}
	imageRef = strings.TrimSpace(imageRef)
	if err := validateImageReference(imageRef); err != nil {
		return EngineImageResult{}, err
	}
	raw, err := c.run(ctx, engine, "pull", imageRef)
	if err != nil {
		return EngineImageResult{}, err
	}
	digest := firstDigest([]string{imageRef, string(raw)})
	if digest == "" {
		digest = extractPullDigest(raw)
	}
	return EngineImageResult{
		Engine: engine,
		Image: ImageInput{
			Reference: imageRef,
			Digest:    digest,
		},
		Completed: true,
	}, nil
}

func (c *CLIClient) run(ctx context.Context, engine Engine, args ...string) ([]byte, error) {
	runner := c.Runner
	if runner == nil {
		runner = execRunner{}
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = defaultCommandTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	args = endpointArgs(ctx, engine, args)
	out, err := runner.Run(runCtx, string(engine), args...)
	if ctxErr := runCtx.Err(); ctxErr != nil {
		if parentErr := ctx.Err(); parentErr != nil {
			return nil, parentErr
		}
		return nil, fmt.Errorf("%w: %s", ErrEngineTimeout, engine)
	}
	if isCommandNotFound(err) {
		return nil, fmt.Errorf("%w: %s", ErrCLIUnavailable, engine)
	}
	if len(out) > maxCommandOutputBytes {
		return nil, ErrCommandOutputLimit
	}
	return out, err
}

func (c *CLIClient) stream(ctx context.Context, engine Engine, args []string, onStdoutLine func(context.Context, []byte) error) error {
	var streamer CommandStreamer
	if c.Runner == nil {
		streamer = execRunner{}
	} else {
		var ok bool
		streamer, ok = c.Runner.(CommandStreamer)
		if !ok || streamer == nil {
			return ErrLogsFollowUnsupported
		}
	}
	streamCtx := ctx
	var cancel context.CancelFunc
	if c.StreamTimeout > 0 {
		streamCtx, cancel = context.WithTimeout(ctx, c.StreamTimeout)
		defer cancel()
	}
	args = endpointArgs(ctx, engine, args)
	return streamer.Stream(streamCtx, string(engine), args, func(line []byte) error {
		return onStdoutLine(streamCtx, line)
	})
}

func actionArgs(method Method, containerID string, force bool, timeoutSec int) []string {
	switch method {
	case MethodStart:
		return []string{"start", containerID}
	case MethodStop:
		args := []string{"stop"}
		if timeoutSec > 0 {
			args = append(args, "--time", strconv.Itoa(timeoutSec))
		}
		return append(args, containerID)
	case MethodRestart:
		args := []string{"restart"}
		if timeoutSec > 0 {
			args = append(args, "--time", strconv.Itoa(timeoutSec))
		}
		return append(args, containerID)
	case MethodRemove:
		args := []string{"rm"}
		if force {
			args = append(args, "--force")
		}
		return append(args, containerID)
	case MethodPause:
		return []string{"pause", containerID}
	case MethodUnpause:
		return []string{"unpause", containerID}
	case MethodKill:
		return []string{"kill", containerID}
	default:
		return nil
	}
}

func normalizeTailLines(value int) (int, error) {
	if value < 0 {
		return 0, errors.New("tail_lines must be non-negative")
	}
	if value == 0 {
		return defaultLogTailLines, nil
	}
	if value > maxLogTailLines {
		return maxLogTailLines, nil
	}
	return value, nil
}

type execRunner struct{}

const maxCommandStderrBytes = 64 * 1024

type boundedCommandStderr struct {
	data []byte
}

func (w *boundedCommandStderr) Write(value []byte) (int, error) {
	remaining := maxCommandStderrBytes - len(w.data)
	if remaining > 0 {
		if len(value) < remaining {
			remaining = len(value)
		}
		w.data = append(w.data, value[:remaining]...)
	}
	return len(value), nil
}

func (execRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	if _, err := exec.LookPath(name); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrCLIUnavailable, name)
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = processenv.Current()
	configureCommandProcessGroup(cmd)
	cmd.Cancel = func() error {
		return terminateCommandProcessTree(cmd)
	}
	var stderr boundedCommandStderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, errors.New("container command stdout pipe failed")
	}
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		if errors.Is(err, os.ErrPermission) {
			return nil, ErrPermissionDenied
		}
		return nil, errors.New("container command start failed")
	}
	out, readErr := io.ReadAll(io.LimitReader(stdout, maxCommandOutputBytes+1))
	if len(out) > maxCommandOutputBytes {
		if cmd.Process != nil {
			_ = terminateCommandProcessTree(cmd)
		}
		_ = cmd.Wait()
		return nil, ErrCommandOutputLimit
	}
	if readErr != nil && cmd.Process != nil {
		_ = terminateCommandProcessTree(cmd)
	}
	waitErr := cmd.Wait()
	if readErr != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, errors.New("container command output read failed")
	}
	if waitErr != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, classifyCommandFailure(args, waitErr, stderr.data)
	}
	return out, nil
}

func (execRunner) Stream(ctx context.Context, name string, args []string, onStdoutLine func([]byte) error) error {
	if _, err := exec.LookPath(name); err != nil {
		return fmt.Errorf("%w: %s", ErrCLIUnavailable, name)
	}
	if onStdoutLine == nil {
		return errors.New("stdout line handler is required")
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = processenv.Current()
	configureCommandProcessGroup(cmd)
	cmd.Cancel = func() error {
		return terminateCommandProcessTree(cmd)
	}
	var stderr boundedCommandStderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		if errors.Is(err, os.ErrPermission) {
			return ErrPermissionDenied
		}
		return err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLogLineBytes)
	var callbackErr error
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		if err := onStdoutLine(line); err != nil {
			callbackErr = err
			if cmd.Process != nil {
				_ = terminateCommandProcessTree(cmd)
			}
			break
		}
	}
	scanErr := scanner.Err()
	if scanErr != nil && cmd.Process != nil {
		_ = terminateCommandProcessTree(cmd)
	}
	waitErr := cmd.Wait()
	if callbackErr != nil {
		return callbackErr
	}
	if scanErr != nil {
		return fmt.Errorf("container stream output read failed: %w", scanErr)
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if waitErr != nil {
		return classifyCommandFailure(args, waitErr, stderr.data)
	}
	return nil
}

func isCommandNotFound(err error) bool {
	if err == nil || errors.Is(err, ErrCLIUnavailable) || errors.Is(err, exec.ErrNotFound) {
		return err != nil
	}
	var execError *exec.Error
	return errors.As(err, &execError)
}

func classifyCommandFailure(args []string, cause error, stderr ...[]byte) error {
	if errors.Is(cause, os.ErrPermission) {
		return ErrPermissionDenied
	}
	detail := ""
	if len(stderr) > 0 {
		detail = strings.ToLower(string(stderr[0]))
	}
	for _, marker := range []string{"permission denied while trying to connect", "docker.sock: permission denied", "podman.sock: permission denied"} {
		if strings.Contains(detail, marker) {
			return ErrPermissionDenied
		}
	}
	for _, marker := range []string{"is the docker daemon running", "daemon is not running", "podman socket is not running", "podman machine is not running"} {
		if strings.Contains(detail, marker) {
			return ErrDaemonStopped
		}
	}
	for _, marker := range []string{"cannot connect", "connection refused", "no route to host", "network is unreachable"} {
		if strings.Contains(detail, marker) {
			return ErrBackendUnreachable
		}
	}
	if len(args) > 0 && args[0] == "logs" {
		return ErrLogsUnavailable
	}
	return fmt.Errorf("container command failed: %w", cause)
}

type inspectDocument struct {
	ID              string                 `json:"Id"`
	Name            string                 `json:"Name"`
	Created         string                 `json:"Created"`
	Image           string                 `json:"Image"`
	RepoDigests     []string               `json:"RepoDigests"`
	Config          inspectConfig          `json:"Config"`
	State           inspectState           `json:"State"`
	HostConfig      inspectHostConfig      `json:"HostConfig"`
	Mounts          []inspectMount         `json:"Mounts"`
	NetworkSettings inspectNetworkSettings `json:"NetworkSettings"`
}

type inspectConfig struct {
	Image       string            `json:"Image"`
	Env         []string          `json:"Env"`
	Labels      map[string]string `json:"Labels"`
	RepoDigests []string          `json:"RepoDigests"`
}

type inspectState struct {
	Status     string `json:"Status"`
	Running    bool   `json:"Running"`
	Paused     bool   `json:"Paused"`
	Restarting bool   `json:"Restarting"`
	Health     *struct {
		Status string `json:"Status"`
	} `json:"Health"`
}

type inspectHostConfig struct {
	Privileged    bool                   `json:"Privileged"`
	NetworkMode   string                 `json:"NetworkMode"`
	PIDMode       string                 `json:"PidMode"`
	IPCMode       string                 `json:"IpcMode"`
	RestartPolicy inspectRestartPolicy   `json:"RestartPolicy"`
	CapAdd        []string               `json:"CapAdd"`
	CapDrop       []string               `json:"CapDrop"`
	Devices       []inspectDeviceMapping `json:"Devices"`
}

type inspectRestartPolicy struct {
	Name string `json:"Name"`
}

type inspectMount struct {
	Type        string `json:"Type"`
	Name        string `json:"Name"`
	Source      string `json:"Source"`
	Destination string `json:"Destination"`
	Target      string `json:"Target"`
	RW          bool   `json:"RW"`
}

type inspectDeviceMapping struct {
	PathOnHost        string `json:"PathOnHost"`
	PathInContainer   string `json:"PathInContainer"`
	CgroupPermissions string `json:"CgroupPermissions"`
}

type inspectNetworkSettings struct {
	Ports map[string][]inspectPortBinding `json:"Ports"`
}

type inspectPortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

func parseContainerInspect(engine Engine, raw []byte) (EngineContainer, error) {
	var docs []inspectDocument
	if err := json.Unmarshal(bytes.TrimSpace(raw), &docs); err != nil {
		return EngineContainer{}, fmt.Errorf("parse container inspect: %w", err)
	}
	if len(docs) != 1 {
		return EngineContainer{}, fmt.Errorf("container inspect returned %d records, want 1", len(docs))
	}
	doc := docs[0]
	image := ImageInput{
		Reference: strings.TrimSpace(doc.Config.Image),
		Digest:    firstDigest(append(append([]string(nil), doc.RepoDigests...), doc.Config.RepoDigests...)),
		RuntimeID: cleanImageMetadata(doc.Image),
	}
	if image.Reference == "" {
		image.Reference = image.RuntimeID
	}
	return EngineContainer{
		Engine:          engine,
		ContainerID:     strings.TrimSpace(doc.ID),
		Name:            strings.TrimPrefix(strings.TrimSpace(doc.Name), "/"),
		Image:           image,
		State:           normalizeContainerState(doc.State),
		Health:          inspectHealth(doc.State),
		CreatedAtUnixMs: parseTimeUnixMs(doc.Created),
		Runtime: RuntimeInput{
			Privileged:    doc.HostConfig.Privileged,
			NetworkMode:   strings.TrimSpace(doc.HostConfig.NetworkMode),
			PIDMode:       strings.TrimSpace(doc.HostConfig.PIDMode),
			IPCMode:       strings.TrimSpace(doc.HostConfig.IPCMode),
			RestartPolicy: strings.TrimSpace(doc.HostConfig.RestartPolicy.Name),
			Env:           append([]string(nil), doc.Config.Env...),
			Labels:        cloneStringMap(doc.Config.Labels),
			Mounts:        inspectMountInputs(doc.Mounts),
			Devices:       inspectDeviceInputs(doc.HostConfig.Devices),
			CapAdd:        append([]string(nil), doc.HostConfig.CapAdd...),
			CapDrop:       append([]string(nil), doc.HostConfig.CapDrop...),
		},
		Ports:     inspectPortSummaries(doc.NetworkSettings.Ports),
		GroupKind: containerGroup(engine, doc.Config.Labels, "", "").Kind,
		GroupID:   containerGroup(engine, doc.Config.Labels, "", "").ID,
		GroupName: containerGroup(engine, doc.Config.Labels, "", "").Name,
	}, nil
}

type listEntry struct {
	ID           string              `json:"ID"`
	IDAlt        string              `json:"Id"`
	Names        any                 `json:"Names"`
	NamesAlt     any                 `json:"NamesArray"`
	Image        string              `json:"Image"`
	ImageID      string              `json:"ImageID"`
	State        string              `json:"State"`
	Status       string              `json:"Status"`
	Ports        json.RawMessage     `json:"Ports"`
	ExposedPorts map[string][]string `json:"ExposedPorts"`
	CreatedAt    string              `json:"CreatedAt"`
	Created      json.Number         `json:"Created"`
	Labels       json.RawMessage     `json:"Labels"`
	Pod          string              `json:"Pod"`
	PodName      string              `json:"PodName"`
}

type listPortMapping struct {
	HostIP        string `json:"host_ip"`
	ContainerPort uint16 `json:"container_port"`
	HostPort      uint16 `json:"host_port"`
	Range         uint16 `json:"range"`
	Protocol      string `json:"protocol"`
}

func inspectHealth(state inspectState) string {
	if state.Health == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(state.Health.Status))
}

func listHealth(status string) string {
	status = strings.ToLower(status)
	for _, value := range []string{"healthy", "unhealthy", "starting"} {
		if strings.Contains(status, "("+value+")") {
			return value
		}
	}
	return ""
}

func parseContainerList(engine Engine, raw []byte) ([]EngineContainer, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, nil
	}
	var entries []listEntry
	if bytes.HasPrefix(trimmed, []byte("[")) {
		if err := json.Unmarshal(trimmed, &entries); err != nil {
			return nil, fmt.Errorf("parse container list: %w", err)
		}
	} else {
		decoder := json.NewDecoder(bytes.NewReader(trimmed))
		decoder.UseNumber()
		for {
			var entry listEntry
			if err := decoder.Decode(&entry); err != nil {
				if errors.Is(err, io.EOF) {
					break
				}
				return nil, fmt.Errorf("parse container list entry: %w", err)
			}
			entries = append(entries, entry)
		}
	}
	out := make([]EngineContainer, 0, len(entries))
	for _, entry := range entries {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			id = strings.TrimSpace(entry.IDAlt)
		}
		createdAt := parseTimeUnixMs(entry.CreatedAt)
		if createdAt == 0 {
			createdAt = parseUnixSecondsMs(entry.Created)
		}
		ports, err := parseListPorts(entry.Ports, entry.ExposedPorts)
		if err != nil {
			return nil, fmt.Errorf("parse container list ports: %w", err)
		}
		group := listContainerGroup(engine, entry.Labels, entry.Pod, entry.PodName)
		out = append(out, EngineContainer{
			Engine:          engine,
			ContainerID:     id,
			Name:            firstName(entry.Names, entry.NamesAlt),
			Image:           ImageInput{Reference: strings.TrimSpace(entry.Image)},
			State:           normalizeStateString(entry.State, entry.Status),
			Health:          listHealth(entry.Status),
			CreatedAtUnixMs: createdAt,
			Ports:           ports,
			GroupKind:       group.Kind,
			GroupID:         group.ID,
			GroupName:       group.Name,
		})
	}
	return out, nil
}

func parseListPorts(raw json.RawMessage, exposed map[string][]string) ([]PortSummary, error) {
	var out []PortSummary
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) > 0 && !bytes.Equal(trimmed, []byte("null")) {
		switch trimmed[0] {
		case '"':
			var value string
			if err := json.Unmarshal(trimmed, &value); err != nil {
				return nil, err
			}
			out = append(out, parseListPortString(value)...)
		case '[':
			var mappings []listPortMapping
			if err := json.Unmarshal(trimmed, &mappings); err != nil {
				return nil, err
			}
			for _, mapping := range mappings {
				ports, err := expandListPortMapping(mapping)
				if err != nil {
					return nil, err
				}
				out = append(out, ports...)
			}
		default:
			return nil, errors.New("ports must be a string or array")
		}
	}
	exposedPortKeys := make([]string, 0, len(exposed))
	for portText := range exposed {
		exposedPortKeys = append(exposedPortKeys, portText)
	}
	sort.Slice(exposedPortKeys, func(i, j int) bool {
		return atoi(exposedPortKeys[i]) < atoi(exposedPortKeys[j])
	})
	for _, portText := range exposedPortKeys {
		port := atoi(portText)
		if port < 1 || port > 65535 {
			continue
		}
		protocols := append([]string(nil), exposed[portText]...)
		sort.Strings(protocols)
		for _, protocol := range protocols {
			candidate := PortSummary{Port: port, Protocol: normalizePortProtocol(protocol)}
			if !containsContainerPort(out, candidate) {
				out = append(out, candidate)
			}
		}
	}
	return out, nil
}

func parseListPortString(value string) []PortSummary {
	var out []PortSummary
	for _, entry := range strings.Split(value, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		host, container, published := strings.Cut(entry, "->")
		if !published {
			container = host
			host = ""
		}
		portText, protocol, _ := strings.Cut(strings.TrimSpace(container), "/")
		port := atoi(portText)
		if port < 1 || port > 65535 {
			continue
		}
		item := PortSummary{Port: port, Protocol: strings.ToLower(strings.TrimSpace(protocol))}
		if item.Protocol == "" {
			item.Protocol = "tcp"
		}
		if host != "" {
			host = strings.TrimSpace(host)
			if address, portValue, err := net.SplitHostPort(host); err == nil {
				item.HostIP = strings.Trim(address, "[]")
				item.HostPort = atoi(portValue)
			} else if index := strings.LastIndex(host, ":"); index >= 0 {
				item.HostIP = strings.Trim(host[:index], "[]")
				item.HostPort = atoi(host[index+1:])
			} else {
				item.HostPort = atoi(host)
			}
		}
		out = append(out, item)
	}
	return out
}

func expandListPortMapping(mapping listPortMapping) ([]PortSummary, error) {
	count := int(mapping.Range)
	if count == 0 {
		count = 1
	}
	containerPort := int(mapping.ContainerPort)
	hostPort := int(mapping.HostPort)
	if containerPort < 1 || containerPort+count-1 > 65535 || (hostPort > 0 && hostPort+count-1 > 65535) {
		return nil, errors.New("port mapping is outside the valid range")
	}
	protocols := strings.Split(mapping.Protocol, ",")
	if strings.TrimSpace(mapping.Protocol) == "" {
		protocols = []string{"tcp"}
	}
	out := make([]PortSummary, 0, count*len(protocols))
	for offset := 0; offset < count; offset++ {
		for _, protocol := range protocols {
			item := PortSummary{
				Protocol: normalizePortProtocol(protocol),
				HostIP:   strings.TrimSpace(mapping.HostIP),
				Port:     containerPort + offset,
			}
			if hostPort > 0 {
				item.HostPort = hostPort + offset
			}
			out = appendUniquePort(out, item)
		}
	}
	return out, nil
}

func normalizePortProtocol(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "tcp"
	}
	return value
}

func appendUniquePort(ports []PortSummary, candidate PortSummary) []PortSummary {
	for _, port := range ports {
		if port == candidate {
			return ports
		}
	}
	return append(ports, candidate)
}

func containsContainerPort(ports []PortSummary, candidate PortSummary) bool {
	for _, port := range ports {
		if port.Port == candidate.Port && port.Protocol == candidate.Protocol {
			return true
		}
	}
	return false
}

func parseLogLines(raw []byte) []LogLine {
	text := strings.TrimRight(string(raw), "\r\n")
	if strings.TrimSpace(text) == "" {
		return nil
	}
	lines := strings.Split(text, "\n")
	out := make([]LogLine, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSuffix(line, "\r")
		timestampUnixMs, message := splitLogTimestamp(line)
		out = append(out, LogLine{
			TimestampUnixMs: timestampUnixMs,
			Message:         message,
		})
	}
	return out
}

func splitLogTimestamp(line string) (int64, string) {
	token, rest, found := strings.Cut(line, " ")
	if !found {
		return 0, line
	}
	parsed, err := time.Parse(time.RFC3339Nano, token)
	if err != nil {
		return 0, line
	}
	return parsed.UnixMilli(), rest
}

func extractVersion(raw []byte) string {
	var value any
	if err := json.Unmarshal(bytes.TrimSpace(raw), &value); err != nil {
		return ""
	}
	return findFirstString(value, "ServerVersion", "server_version", "Version", "version")
}

func findFirstString(value any, keys ...string) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range keys {
			if raw, ok := typed[key]; ok {
				if text, ok := raw.(string); ok && strings.TrimSpace(text) != "" {
					return strings.TrimSpace(text)
				}
			}
		}
		for _, key := range []string{"Server", "server", "Engine", "engine", "Client", "client"} {
			if raw, ok := typed[key]; ok {
				if text := findFirstString(raw, keys...); text != "" {
					return text
				}
			}
		}
		for _, raw := range typed {
			if text := findFirstString(raw, keys...); text != "" {
				return text
			}
		}
	case []any:
		for _, raw := range typed {
			if text := findFirstString(raw, keys...); text != "" {
				return text
			}
		}
	}
	return ""
}

func normalizeContainerState(state inspectState) ContainerState {
	if state.Running {
		return ContainerStateRunning
	}
	if state.Paused {
		return ContainerStatePaused
	}
	if state.Restarting {
		return ContainerStateRestarting
	}
	return normalizeStateString(state.Status, "")
}

func normalizeStateString(values ...string) ContainerState {
	joined := strings.ToLower(strings.Join(values, " "))
	switch {
	case strings.Contains(joined, "running") || strings.Contains(joined, "up "):
		return ContainerStateRunning
	case strings.Contains(joined, "paused"):
		return ContainerStatePaused
	case strings.Contains(joined, "restarting"):
		return ContainerStateRestarting
	case strings.Contains(joined, "created"):
		return ContainerStateCreated
	case strings.Contains(joined, "exited") || strings.Contains(joined, "dead"):
		return ContainerStateExited
	case strings.Contains(joined, "stopped"):
		return ContainerStateStopped
	default:
		return ContainerStateUnknown
	}
}

func inspectMountInputs(mounts []inspectMount) []MountInput {
	out := make([]MountInput, 0, len(mounts))
	for _, mount := range mounts {
		mountType := normalizeMountType(mount.Type)
		source := strings.TrimSpace(mount.Source)
		if mountType == MountTypeVolume && strings.TrimSpace(mount.Name) != "" {
			source = strings.TrimSpace(mount.Name)
		}
		target := strings.TrimSpace(mount.Destination)
		if target == "" {
			target = strings.TrimSpace(mount.Target)
		}
		out = append(out, MountInput{
			Type:     mountType,
			Source:   source,
			Target:   target,
			ReadOnly: !mount.RW,
		})
	}
	return out
}

func normalizeMountType(value string) MountType {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "bind":
		return MountTypeBind
	case "volume":
		return MountTypeVolume
	case "tmpfs":
		return MountTypeTmpfs
	default:
		return MountTypeOther
	}
}

func inspectDeviceInputs(devices []inspectDeviceMapping) []DeviceInput {
	out := make([]DeviceInput, 0, len(devices))
	for _, device := range devices {
		out = append(out, DeviceInput{
			HostPath:      strings.TrimSpace(device.PathOnHost),
			ContainerPath: strings.TrimSpace(device.PathInContainer),
			Permissions:   strings.TrimSpace(device.CgroupPermissions),
		})
	}
	return out
}

func inspectPortSummaries(ports map[string][]inspectPortBinding) []PortSummary {
	out := make([]PortSummary, 0, len(ports))
	for key, bindings := range ports {
		port, protocol := parsePortKey(key)
		if len(bindings) == 0 {
			out = append(out, PortSummary{Protocol: protocol, Port: port})
			continue
		}
		for _, binding := range bindings {
			out = append(out, PortSummary{
				Protocol: protocol,
				HostIP:   strings.TrimSpace(binding.HostIP),
				HostPort: atoi(binding.HostPort),
				Port:     port,
			})
		}
	}
	return out
}

func parsePortKey(key string) (int, string) {
	portText, protocol, found := strings.Cut(strings.TrimSpace(key), "/")
	if !found {
		protocol = "tcp"
	}
	return atoi(portText), strings.TrimSpace(protocol)
}

func firstDigest(values []string) string {
	for _, value := range values {
		if _, digest, ok := strings.Cut(strings.TrimSpace(value), "@"); ok && strings.TrimSpace(digest) != "" {
			return strings.TrimSpace(digest)
		}
	}
	return ""
}

func extractPullDigest(raw []byte) string {
	for _, line := range strings.Split(string(raw), "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), ":")
		if !found || !strings.EqualFold(strings.TrimSpace(key), "digest") {
			continue
		}
		if digest := strings.TrimSpace(value); digest != "" {
			return digest
		}
	}
	return ""
}

func firstName(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			parts := strings.Split(typed, ",")
			if name := strings.TrimSpace(parts[0]); name != "" {
				return strings.TrimPrefix(name, "/")
			}
		case []any:
			for _, item := range typed {
				if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
					return strings.TrimPrefix(strings.TrimSpace(text), "/")
				}
			}
		case []string:
			for _, item := range typed {
				if strings.TrimSpace(item) != "" {
					return strings.TrimPrefix(strings.TrimSpace(item), "/")
				}
			}
		}
	}
	return ""
}

func parseTimeUnixMs(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05 -0700 MST",
		"2006-01-02 15:04:05 -0700 -0700",
	} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed.UnixMilli()
		}
	}
	return 0
}

func parseUnixSecondsMs(value json.Number) int64 {
	if strings.TrimSpace(value.String()) == "" {
		return 0
	}
	seconds, err := value.Int64()
	if err != nil {
		return 0
	}
	return seconds * 1000
}

func cloneStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func atoi(value string) int {
	out, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0
	}
	return out
}
