package containers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const (
	defaultCommandTimeout = 10 * time.Second
	defaultLogTailLines   = 100
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
		return EngineStatus{Engine: engine, Available: false}, nil
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
	if containerID == "" {
		return EngineContainer{}, errors.New("container_id is required")
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
	if containerID == "" {
		return EngineLogsResult{}, errors.New("container_id is required")
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
	if containerID == "" {
		return errors.New("container_id is required")
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
	if imageRef == "" {
		return EngineImageResult{}, errors.New("image_ref is required")
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
	return runner.Run(runCtx, string(engine), args...)
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

func (execRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	if _, err := exec.LookPath(name); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, name, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return nil, fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, detail)
		}
		return nil, fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return out, nil
}

func (execRunner) Stream(ctx context.Context, name string, args []string, onStdoutLine func([]byte) error) error {
	if _, err := exec.LookPath(name); err != nil {
		return err
	}
	if onStdoutLine == nil {
		return errors.New("stdout line handler is required")
	}
	cmd := exec.CommandContext(ctx, name, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
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
				_ = cmd.Process.Kill()
			}
			break
		}
	}
	scanErr := scanner.Err()
	if scanErr != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()
	if callbackErr != nil {
		return callbackErr
	}
	if scanErr != nil {
		return fmt.Errorf("%s %s: read stdout: %w", name, strings.Join(args, " "), scanErr)
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if waitErr != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), waitErr, detail)
		}
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), waitErr)
	}
	return nil
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
	}
	if image.Reference == "" {
		image.Reference = strings.TrimSpace(doc.Image)
	}
	return EngineContainer{
		Engine:          engine,
		ContainerID:     strings.TrimSpace(doc.ID),
		Name:            strings.TrimPrefix(strings.TrimSpace(doc.Name), "/"),
		Image:           image,
		State:           normalizeContainerState(doc.State),
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
		Ports: inspectPortSummaries(doc.NetworkSettings.Ports),
	}, nil
}

type listEntry struct {
	ID        string      `json:"ID"`
	IDAlt     string      `json:"Id"`
	Names     any         `json:"Names"`
	NamesAlt  any         `json:"NamesArray"`
	Image     string      `json:"Image"`
	ImageID   string      `json:"ImageID"`
	State     string      `json:"State"`
	Status    string      `json:"Status"`
	CreatedAt string      `json:"CreatedAt"`
	Created   json.Number `json:"Created"`
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
		out = append(out, EngineContainer{
			Engine:          engine,
			ContainerID:     id,
			Name:            firstName(entry.Names, entry.NamesAlt),
			Image:           ImageInput{Reference: strings.TrimSpace(entry.Image)},
			State:           normalizeStateString(entry.State, entry.Status),
			CreatedAtUnixMs: createdAt,
		})
	}
	return out, nil
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
		target := strings.TrimSpace(mount.Destination)
		if target == "" {
			target = strings.TrimSpace(mount.Target)
		}
		out = append(out, MountInput{
			Type:     normalizeMountType(mount.Type),
			Source:   strings.TrimSpace(mount.Source),
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
