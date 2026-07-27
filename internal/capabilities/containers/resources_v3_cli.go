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
	if err := validateEngine(req.Engine); err != nil {
		return ContainerActionResponse{}, err
	}
	if strings.TrimSpace(req.Image) == "" {
		return ContainerActionResponse{}, errors.New("image is required")
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
	if req.Privileged {
		args = append(args, "--privileged")
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
		out = append(out, ImageRecord{ID: firstNonEmpty(value.ID, value.Id), Reference: reference, Digest: value.Digest, Tags: value.RepoTags})
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
}

func (c *CLIClient) InspectImage(ctx context.Context, engine Engine, image string) (ImageRecord, error) {
	if err := validateEngine(engine); err != nil {
		return ImageRecord{}, err
	}
	if strings.TrimSpace(image) == "" {
		return ImageRecord{}, errors.New("image is required")
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
	return ImageRecord{ID: firstNonEmpty(docs[0].ID, docs[0].AltID), Tags: docs[0].RepoTags, Digest: firstNonEmpty(firstDigest(docs[0].RepoDigests), docs[0].Digest), SizeBytes: docs[0].Size, Reference: strings.TrimSpace(image)}, nil
}

func (c *CLIClient) HistoryImage(ctx context.Context, engine Engine, image string) ([]ImageHistoryEntry, error) {
	if err := validateEngine(engine); err != nil {
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
		out = append(out, ImageHistoryEntry{ID: firstNonEmpty(v.ID, v.Id), CreatedBy: v.CreatedBy})
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

func (c *CLIClient) TagImage(ctx context.Context, req ImageTagRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	image, tag := strings.TrimSpace(req.Image), strings.TrimSpace(req.Tag)
	if image == "" || tag == "" {
		return errors.New("image and tag are required")
	}
	return c.runDiscard(ctx, req.Engine, "tag", image, tag)
}
func (c *CLIClient) RemoveImage(ctx context.Context, req ImageRemoveRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	image := strings.TrimSpace(req.Image)
	if image == "" {
		return errors.New("image is required")
	}
	args := []string{"image", "rm"}
	if req.Force {
		args = append(args, "--force")
	}
	args = append(args, image)
	return c.runDiscard(ctx, req.Engine, args...)
}
func (c *CLIClient) PruneImages(ctx context.Context, engine Engine, _ string) error {
	if err := validateEngine(engine); err != nil {
		return err
	}
	return c.runDiscard(ctx, engine, "image", "prune", "--force")
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
		out = append(out, VolumeRecord{Name: firstNonEmpty(v.Name, v.NameAlt), Driver: firstNonEmpty(v.Driver, v.DriverAlt), Scope: firstNonEmpty(v.Scope, v.ScopeAlt)})
	}
	return out, nil
}

type volumeRecord struct {
	Name      string `json:"Name"`
	NameAlt   string `json:"name"`
	Driver    string `json:"Driver"`
	DriverAlt string `json:"driver"`
	Scope     string `json:"Scope"`
	ScopeAlt  string `json:"scope"`
}

func (c *CLIClient) InspectVolume(ctx context.Context, engine Engine, name string) (VolumeRecord, error) {
	if err := validateEngine(engine); err != nil {
		return VolumeRecord{}, err
	}
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
	return VolumeRecord{Name: firstNonEmpty(docs[0].Name, docs[0].NameAlt), Driver: firstNonEmpty(docs[0].Driver, docs[0].DriverAlt), Scope: firstNonEmpty(docs[0].Scope, docs[0].ScopeAlt)}, nil
}
func (c *CLIClient) CreateVolume(ctx context.Context, req VolumeCreateRequest) (VolumeRecord, error) {
	if err := validateEngine(req.Engine); err != nil {
		return VolumeRecord{}, err
	}
	args := []string{"volume", "create"}
	if req.Driver != "" {
		args = append(args, "--driver", req.Driver)
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
func (c *CLIClient) RemoveVolume(ctx context.Context, req VolumeRemoveRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return errors.New("volume name is required")
	}
	return c.runDiscard(ctx, req.Engine, "volume", "rm", name)
}
func (c *CLIClient) PruneVolumes(ctx context.Context, engine Engine, _ string) error {
	if err := validateEngine(engine); err != nil {
		return err
	}
	return c.runDiscard(ctx, engine, "volume", "prune", "--force")
}

func (c *CLIClient) runDiscard(ctx context.Context, engine Engine, args ...string) error {
	_, err := c.run(ctx, engine, args...)
	return err
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
