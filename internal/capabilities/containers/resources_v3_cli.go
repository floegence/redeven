package containers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

func (c *CLIClient) CreateContainer(ctx context.Context, req ContainerCreateRequest) (ContainerActionResponse, error) {
	if err := validateContainerCreateRequest(req); err != nil {
		return ContainerActionResponse{}, err
	}
	image := strings.TrimSpace(req.Image)
	args := []string{"run", "-d"}
	if name := strings.TrimSpace(req.Name); name != "" {
		args = append(args, "--name", name)
	}
	if req.RestartPolicy != "" {
		args = append(args, "--restart", strings.TrimSpace(req.RestartPolicy))
	}
	if req.NetworkMode != "" {
		args = append(args, "--network", strings.TrimSpace(req.NetworkMode))
	}
	if req.PIDMode != "" {
		args = append(args, "--pid", strings.TrimSpace(req.PIDMode))
	}
	if req.IPCMode != "" {
		args = append(args, "--ipc", strings.TrimSpace(req.IPCMode))
	}
	if req.CPUCount > 0 {
		args = append(args, "--cpus", strconv.FormatFloat(req.CPUCount, 'f', -1, 64))
	}
	if req.MemoryBytes > 0 {
		args = append(args, "--memory", strconv.FormatInt(req.MemoryBytes, 10))
	}
	if req.Privileged {
		args = append(args, "--privileged")
	}
	for _, port := range req.Ports {
		args = append(args, "--publish", publishedPortArgument(port))
	}
	for _, mount := range req.Mounts {
		args = append(args, "--mount", mountArgument(mount))
	}
	for _, capability := range req.CapAdd {
		args = append(args, "--cap-add", strings.TrimSpace(capability))
	}
	for _, capability := range req.CapDrop {
		args = append(args, "--cap-drop", strings.TrimSpace(capability))
	}
	for _, device := range req.Devices {
		args = append(args, "--device", deviceArgument(device))
	}
	for _, env := range req.Env {
		if strings.TrimSpace(env) != "" {
			args = append(args, "-e", env)
		}
	}
	args = append(args, image)
	args = append(args, req.Command...)
	raw, err := c.run(ctx, req.Engine, args...)
	if err != nil {
		return ContainerActionResponse{}, err
	}
	id := strings.TrimSpace(strings.SplitN(string(raw), "\n", 2)[0])
	if id == "" {
		return ContainerActionResponse{}, errors.New("create container returned an empty container id")
	}
	return ContainerActionResponse{Engine: req.Engine, Method: MethodContainersCreate, ContainerID: id, Completed: true}, nil
}

func (c *CLIClient) Stats(ctx context.Context, engine Engine, containerID string) (ContainerStats, error) {
	if err := validateEngine(engine); err != nil {
		return ContainerStats{}, err
	}
	if strings.TrimSpace(containerID) == "" {
		return ContainerStats{}, errors.New("container_id is required")
	}
	raw, err := c.run(ctx, engine, "stats", "--no-stream", "--format", "json", containerID)
	if err != nil {
		return ContainerStats{}, err
	}
	var values []statsRecord
	if err := decodeJSONLines(raw, &values); err != nil {
		return ContainerStats{}, fmt.Errorf("parse container stats: %w", err)
	}
	if len(values) == 0 {
		return ContainerStats{}, errors.New("parse container stats: empty response")
	}
	value := values[0]
	memory, limit := parsePairBytes(value.MemUsage)
	rx, tx := parsePairBytes(value.NetIO)
	return ContainerStats{
		ContainerID: firstNonEmpty(value.ID, value.Id, value.CID, containerID),
		CPUPercent:  parsePercent(value.CPUPerc, value.CPU), MemoryBytes: memory, MemoryLimit: limit,
		NetworkRxBytes: rx, NetworkTxBytes: tx,
	}, nil
}

type statsRecord struct {
	ID       string `json:"ID"`
	Id       string `json:"Id"`
	CID      string `json:"CID"`
	CPUPerc  string `json:"CPUPerc"`
	CPU      string `json:"CPU"`
	MemUsage string `json:"MemUsage"`
	NetIO    string `json:"NetIO"`
}

func (c *CLIClient) ListImages(ctx context.Context, engine Engine) ([]ImageRecord, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	raw, err := c.run(ctx, engine, "images", "--no-trunc", "--format", "json")
	if err != nil {
		return nil, err
	}
	var values []imageRecord
	if err := decodeJSONLines(raw, &values); err != nil {
		return nil, err
	}
	out := make([]ImageRecord, 0, len(values))
	for _, value := range values {
		reference := value.Reference
		if reference == "" {
			reference = imageReference(value.Repository, value.Tag)
		}
		out = append(out, ImageRecord{
			ID: firstNonEmpty(value.ID, value.Id), Reference: cleanImageMetadata(reference), Digest: cleanImageMetadata(value.Digest), Tags: cleanImageMetadataList(value.RepoTags),
			SizeBytes: parseBytes(value.Size), CreatedAtUnixMs: parseTimeUnixMs(value.CreatedAt),
		})
	}
	containers, inspectionFailures, err := c.inspectAllContainers(ctx, engine)
	if err != nil {
		return nil, err
	}
	for index := range out {
		out[index].ReferencedContainers = countImageReferences(out[index], containers)
		out[index].ReferenceInspectionFailures = inspectionFailures
	}
	return out, nil
}

func imageReference(repository, tag string) string {
	repository, tag = strings.TrimSpace(repository), strings.TrimSpace(tag)
	if repository == "" {
		return ""
	}
	if tag == "" || tag == "<none>" {
		return repository
	}
	return repository + ":" + tag
}

type imageRecord struct {
	ID         string   `json:"ID"`
	Id         string   `json:"Id"`
	Repository string   `json:"Repository"`
	Tag        string   `json:"Tag"`
	Reference  string   `json:"Reference"`
	Digest     string   `json:"Digest"`
	RepoTags   []string `json:"RepoTags"`
	Size       string   `json:"Size"`
	CreatedAt  string   `json:"CreatedAt"`
}

func (c *CLIClient) InspectImage(ctx context.Context, engine Engine, image string) (ImageRecord, error) {
	if err := validateEngine(engine); err != nil {
		return ImageRecord{}, err
	}
	if err := validateImageReference(image); err != nil {
		return ImageRecord{}, err
	}
	raw, err := c.run(ctx, engine, "image", "inspect", image)
	if err != nil {
		return ImageRecord{}, err
	}
	var docs []struct {
		ID          string   `json:"Id"`
		AltID       string   `json:"ID"`
		RepoTags    []string `json:"RepoTags"`
		RepoDigests []string `json:"RepoDigests"`
		Digest      string   `json:"Digest"`
		Size        int64    `json:"Size"`
		Created     string   `json:"Created"`
	}
	if err := json.Unmarshal(raw, &docs); err != nil {
		return ImageRecord{}, fmt.Errorf("parse image inspect: %w", err)
	}
	if len(docs) == 0 {
		return ImageRecord{}, errors.New("parse image inspect: empty response")
	}
	item := ImageRecord{ID: firstNonEmpty(docs[0].ID, docs[0].AltID), Tags: docs[0].RepoTags, Digest: firstNonEmpty(firstDigest(docs[0].RepoDigests), docs[0].Digest), SizeBytes: docs[0].Size, CreatedAtUnixMs: parseTimeUnixMs(docs[0].Created), Reference: strings.TrimSpace(image)}
	containers, inspectionFailures, err := c.inspectAllContainers(ctx, engine)
	if err != nil {
		return ImageRecord{}, err
	}
	item.ReferencedContainers = countImageReferences(item, containers)
	item.ReferenceInspectionFailures = inspectionFailures
	return item, nil
}

func (c *CLIClient) HistoryImage(ctx context.Context, engine Engine, image string) ([]ImageHistoryEntry, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	if err := validateImageReference(image); err != nil {
		return nil, err
	}
	raw, err := c.run(ctx, engine, "history", "--no-trunc", "--format", "json", image)
	if err != nil {
		return nil, err
	}
	var values []historyRecord
	if err := decodeJSONLines(raw, &values); err != nil {
		return nil, err
	}
	out := make([]ImageHistoryEntry, 0, len(values))
	for _, v := range values {
		out = append(out, ImageHistoryEntry{ID: cleanImageMetadata(firstNonEmpty(v.ID, v.Id)), CreatedAtUnixMs: parseTimeUnixMs(v.CreatedAt), SizeBytes: parseBytes(v.Size)})
	}
	return out, nil
}

type historyRecord struct {
	ID        string `json:"ID"`
	Id        string `json:"Id"`
	Size      string `json:"Size"`
	CreatedAt string `json:"CreatedAt"`
	CreatedBy string `json:"CreatedBy"`
}

func cleanImageMetadata(value string) string {
	value = strings.TrimSpace(value)
	if value == "<none>" {
		return ""
	}
	return value
}

func cleanImageMetadataList(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = cleanImageMetadata(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}

func (c *CLIClient) TagImage(ctx context.Context, req ImageTagRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	image, tag := strings.TrimSpace(req.Image), strings.TrimSpace(req.Tag)
	if err := validateImageReference(image); err != nil {
		return err
	}
	if err := validateImageReference(tag); err != nil {
		return err
	}
	return c.runDiscard(ctx, req.Engine, "tag", image, tag)
}
func (c *CLIClient) RemoveImage(ctx context.Context, req ImageRemoveRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	image := strings.TrimSpace(req.Image)
	if err := validateImageReference(image); err != nil {
		return err
	}
	args := []string{"image", "rm"}
	if req.Force {
		args = append(args, "--force")
	}
	args = append(args, image)
	return c.runDiscard(ctx, req.Engine, args...)
}
func (c *CLIClient) PruneImages(ctx context.Context, req ResourcePruneRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if len(req.ResourceIdentities) == 0 {
		return errors.New("resource_identities is required")
	}
	identities := make([]string, len(req.ResourceIdentities))
	for index, identity := range req.ResourceIdentities {
		if err := validateImageReference(identity); err != nil {
			return err
		}
		identities[index] = strings.TrimSpace(identity)
	}
	return pruneExactResources("image", identities, func(identity string) error {
		return c.runDiscard(ctx, req.Engine, "image", "rm", identity)
	})
}
func (c *CLIClient) ListVolumes(ctx context.Context, engine Engine) ([]VolumeRecord, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	raw, err := c.run(ctx, engine, "volume", "ls", "--format", "json")
	if err != nil {
		return nil, err
	}
	var values []volumeRecord
	if err := decodeJSONLines(raw, &values); err != nil {
		return nil, err
	}
	out := make([]VolumeRecord, 0, len(values))
	for _, v := range values {
		out = append(out, VolumeRecord{Name: firstNonEmpty(v.Name, v.NameAlt), Driver: firstNonEmpty(v.Driver, v.DriverAlt), Scope: firstNonEmpty(v.Scope, v.ScopeAlt), CreatedAtUnixMs: parseTimeUnixMs(firstNonEmpty(v.CreatedAt, v.CreatedAtAlt))})
	}
	metadataFailures := 0
	for index := range out {
		if out[index].CreatedAtUnixMs != 0 {
			continue
		}
		metadata, inspectErr := c.inspectVolumeMetadata(ctx, engine, out[index].Name)
		if inspectErr != nil {
			metadataFailures++
			continue
		}
		out[index].CreatedAtUnixMs = metadata.CreatedAtUnixMs
		if out[index].Driver == "" {
			out[index].Driver = metadata.Driver
		}
		if out[index].Scope == "" {
			out[index].Scope = metadata.Scope
		}
	}
	containers, inspectionFailures, err := c.inspectAllContainers(ctx, engine)
	if err != nil {
		return nil, err
	}
	for index := range out {
		out[index].ReferencedContainers = countVolumeReferences(out[index].Name, containers)
		out[index].ReferenceInspectionFailures = inspectionFailures + metadataFailures
	}
	return out, nil
}

type volumeRecord struct {
	Name         string `json:"Name"`
	NameAlt      string `json:"name"`
	Driver       string `json:"Driver"`
	DriverAlt    string `json:"driver"`
	Scope        string `json:"Scope"`
	ScopeAlt     string `json:"scope"`
	CreatedAt    string `json:"CreatedAt"`
	CreatedAtAlt string `json:"created_at"`
}

func (c *CLIClient) InspectVolume(ctx context.Context, engine Engine, name string) (VolumeRecord, error) {
	if err := validateEngine(engine); err != nil {
		return VolumeRecord{}, err
	}
	if err := validateVolumeName(name); err != nil {
		return VolumeRecord{}, err
	}
	item, err := c.inspectVolumeMetadata(ctx, engine, name)
	if err != nil {
		return VolumeRecord{}, err
	}
	containers, inspectionFailures, err := c.inspectAllContainers(ctx, engine)
	if err != nil {
		return VolumeRecord{}, err
	}
	item.ReferencedContainers = countVolumeReferences(item.Name, containers)
	item.ReferenceInspectionFailures = inspectionFailures
	return item, nil
}

func (c *CLIClient) inspectVolumeMetadata(ctx context.Context, engine Engine, name string) (VolumeRecord, error) {
	raw, err := c.run(ctx, engine, "volume", "inspect", name)
	if err != nil {
		return VolumeRecord{}, err
	}
	var docs []struct {
		Name      string `json:"Name"`
		NameAlt   string `json:"name"`
		Driver    string `json:"Driver"`
		DriverAlt string `json:"driver"`
		Scope     string `json:"Scope"`
		ScopeAlt  string `json:"scope"`
		CreatedAt string `json:"CreatedAt"`
	}
	if err := json.Unmarshal(raw, &docs); err != nil {
		return VolumeRecord{}, fmt.Errorf("parse volume inspect: %w", err)
	}
	if len(docs) == 0 {
		return VolumeRecord{}, errors.New("parse volume inspect: empty response")
	}
	item := VolumeRecord{Name: firstNonEmpty(docs[0].Name, docs[0].NameAlt), Driver: firstNonEmpty(docs[0].Driver, docs[0].DriverAlt), Scope: firstNonEmpty(docs[0].Scope, docs[0].ScopeAlt), CreatedAtUnixMs: parseTimeUnixMs(docs[0].CreatedAt)}
	return item, nil
}
func (c *CLIClient) CreateVolume(ctx context.Context, req VolumeCreateRequest) (VolumeRecord, error) {
	if err := validateVolumeCreateRequest(req); err != nil {
		return VolumeRecord{}, err
	}
	args := []string{"volume", "create"}
	if req.Driver != "" {
		args = append(args, "--driver", req.Driver)
	}
	for _, option := range req.Options {
		args = append(args, "--opt", strings.TrimSpace(option.Key)+"="+option.Value)
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		args = append(args, name)
	}
	raw, err := c.run(ctx, req.Engine, args...)
	if err != nil {
		return VolumeRecord{}, err
	}
	name := strings.TrimSpace(string(raw))
	if name == "" {
		return VolumeRecord{}, errors.New("create volume returned an empty volume name")
	}
	return VolumeRecord{Name: name, Driver: strings.TrimSpace(req.Driver)}, nil
}

func publishedPortArgument(port ContainerPortPublish) string {
	protocol := strings.ToLower(strings.TrimSpace(port.Protocol))
	if protocol == "" {
		protocol = "tcp"
	}
	container := strconv.Itoa(port.ContainerPort) + "/" + protocol
	if port.HostPort == 0 {
		return container
	}
	host := strconv.Itoa(port.HostPort)
	if hostIP := strings.TrimSpace(port.HostIP); hostIP != "" {
		if strings.Contains(hostIP, ":") {
			hostIP = "[" + hostIP + "]"
		}
		host = hostIP + ":" + host
	}
	return host + ":" + container
}

func mountArgument(mount ContainerMount) string {
	parts := []string{"type=" + string(mount.Type)}
	if source := strings.TrimSpace(mount.Source); source != "" {
		parts = append(parts, "source="+source)
	}
	parts = append(parts, "target="+strings.TrimSpace(mount.Target))
	if mount.ReadOnly {
		parts = append(parts, "readonly")
	}
	return strings.Join(parts, ",")
}

func deviceArgument(device ContainerDevice) string {
	value := strings.TrimSpace(device.HostPath)
	if target := strings.TrimSpace(device.ContainerPath); target != "" {
		value += ":" + target
	}
	if permissions := strings.TrimSpace(device.Permissions); permissions != "" {
		if strings.TrimSpace(device.ContainerPath) == "" {
			value += ":" + strings.TrimSpace(device.HostPath)
		}
		value += ":" + permissions
	}
	return value
}
func (c *CLIClient) RemoveVolume(ctx context.Context, req VolumeRemoveRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	name := strings.TrimSpace(req.Name)
	if err := validateVolumeName(name); err != nil {
		return err
	}
	return c.runDiscard(ctx, req.Engine, "volume", "rm", name)
}
func (c *CLIClient) PruneVolumes(ctx context.Context, req ResourcePruneRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if len(req.ResourceIdentities) == 0 {
		return errors.New("resource_identities is required")
	}
	identities := make([]string, len(req.ResourceIdentities))
	for index, identity := range req.ResourceIdentities {
		identity = strings.TrimSpace(identity)
		if identity == "" || strings.HasPrefix(identity, "-") || hasControl(identity) {
			return errors.New("resource identity is invalid")
		}
		identities[index] = identity
	}
	return pruneExactResources("volume", identities, func(identity string) error {
		return c.runDiscard(ctx, req.Engine, "volume", "rm", identity)
	})
}

func pruneExactResources(kind string, identities []string, remove func(string) error) error {
	for index, identity := range identities {
		if err := remove(identity); err != nil {
			if index == 0 {
				return err
			}
			return &ResourcePrunePartialError{
				ResourceKind:        kind,
				CompletedIdentities: append([]string(nil), identities[:index]...),
				PendingIdentities:   append([]string(nil), identities[index:]...),
				Cause:               err,
			}
		}
	}
	return nil
}

func (c *CLIClient) runDiscard(ctx context.Context, engine Engine, args ...string) error {
	_, err := c.run(ctx, engine, args...)
	return err
}

func (c *CLIClient) inspectAllContainers(ctx context.Context, engine Engine) ([]EngineContainer, int, error) {
	listed, err := c.List(ctx, engine, true)
	if err != nil {
		return nil, 0, err
	}
	inspected := make([]EngineContainer, 0, len(listed))
	failures := 0
	for _, item := range listed {
		value, err := c.Inspect(ctx, engine, item.ContainerID)
		if err != nil {
			if errors.Is(err, ErrContainerNotFound) {
				continue
			}
			failures++
			continue
		}
		inspected = append(inspected, value)
	}
	return inspected, failures, nil
}

func countImageReferences(image ImageRecord, containers []EngineContainer) int {
	candidates := []string{image.ID, image.Reference, image.Digest}
	candidates = append(candidates, image.Tags...)
	count := 0
	for _, container := range containers {
		if anyImageIdentityMatches(candidates, container.Image.Reference, container.Image.Digest, container.Image.RuntimeID) {
			count++
		}
	}
	return count
}

func anyImageIdentityMatches(candidates []string, values ...string) bool {
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value == candidate || (strings.HasPrefix(candidate, "sha256:") && strings.HasPrefix(value, candidate)) || (strings.HasPrefix(value, "sha256:") && strings.HasPrefix(candidate, value)) {
				return true
			}
		}
	}
	return false
}

func countVolumeReferences(name string, containers []EngineContainer) int {
	name = strings.TrimSpace(name)
	count := 0
	for _, container := range containers {
		for _, mount := range container.Runtime.Mounts {
			if mount.Type == MountTypeVolume && strings.TrimSpace(mount.Source) == name {
				count++
				break
			}
		}
	}
	return count
}
func decodeJSONLines(raw []byte, out any) error {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return nil
	}
	if strings.HasPrefix(text, "[") {
		if err := json.Unmarshal([]byte(text), out); err != nil {
			return fmt.Errorf("parse JSON list: %w", err)
		}
		return nil
	}
	dst := reflect.ValueOf(out)
	if dst.Kind() != reflect.Pointer || dst.Elem().Kind() != reflect.Slice {
		return errors.New("JSON line destination must be a slice pointer")
	}
	itemType := dst.Elem().Type().Elem()
	result := reflect.MakeSlice(dst.Elem().Type(), 0, 8)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		item := reflect.New(itemType)
		if err := json.Unmarshal([]byte(line), item.Interface()); err != nil {
			return fmt.Errorf("parse JSON line: %w", err)
		}
		result = reflect.Append(result, item.Elem())
	}
	dst.Elem().Set(result)
	return nil
}
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func parsePercent(value ...string) float64 {
	for _, candidate := range value {
		candidate = strings.TrimSpace(strings.TrimSuffix(candidate, "%"))
		if candidate == "" {
			continue
		}
		if parsed, err := strconv.ParseFloat(candidate, 64); err == nil && parsed >= 0 {
			return parsed
		}
	}
	return 0
}

func parsePairBytes(value string) (int64, int64) {
	parts := strings.SplitN(value, "/", 2)
	if len(parts) != 2 {
		return parseBytes(value), 0
	}
	return parseBytes(parts[0]), parseBytes(parts[1])
}

func parseBytes(value string) int64 {
	value = strings.TrimSpace(strings.ReplaceAll(value, ",", ""))
	if value == "" || value == "-" {
		return 0
	}
	units := []struct {
		suffix string
		factor float64
	}{
		{"GiB", 1 << 30}, {"MiB", 1 << 20}, {"KiB", 1 << 10}, {"GB", 1e9}, {"MB", 1e6}, {"KB", 1e3}, {"kB", 1e3}, {"B", 1},
	}
	for _, unit := range units {
		if strings.HasSuffix(value, unit.suffix) {
			number := strings.TrimSpace(strings.TrimSuffix(value, unit.suffix))
			parsed, err := strconv.ParseFloat(number, 64)
			if err != nil || parsed < 0 {
				return 0
			}
			return int64(parsed * unit.factor)
		}
	}
	return 0
}
