package containerengine

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"path"
	"sort"
	"strings"
	"time"
)

const (
	maxResourceFileEntries = 1000
	maxResourceFileBytes   = 4 * 1024 * 1024
)

var ErrResourceFileLimit = errors.New("container resource file limit exceeded")

type ContainerFileRequest struct {
	Engine      Engine     `json:"engine"`
	EndpointID  EndpointID `json:"endpoint_id,omitempty"`
	ContainerID string     `json:"container_id"`
	Path        string     `json:"path"`
}

type VolumeFileRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
	Name       string     `json:"name"`
	Path       string     `json:"path"`
}

type ResourceFileEntry struct {
	Name             string `json:"name"`
	Path             string `json:"path"`
	Kind             string `json:"kind"`
	SizeBytes        int64  `json:"size_bytes,omitempty"`
	Mode             string `json:"mode,omitempty"`
	ModifiedAtUnixMs int64  `json:"modified_at_unix_ms,omitempty"`
}

type ResourceFileListing struct {
	Path      string              `json:"path"`
	Entries   []ResourceFileEntry `json:"entries"`
	Truncated bool                `json:"truncated"`
}

type ResourceFileContent struct {
	Name      string
	MediaType string
	Data      []byte
}

type resourceReadClient interface {
	StatsMany(context.Context, Engine) ([]ContainerStats, error)
	RawInspectContainer(context.Context, Engine, string) (json.RawMessage, error)
	ContainerArchive(context.Context, Engine, string, string) ([]byte, error)
	VolumeArchive(context.Context, Engine, string) ([]byte, error)
}

type volumeArchiveStreamClient interface {
	StreamVolumeArchive(context.Context, Engine, string, func(io.Reader) error) error
}

func (a *Adapter) StatsCollection(ctx context.Context, req ContainerStatsCollectionRequest) (ContainerStatsCollection, error) {
	client, ok := a.client.(resourceReadClient)
	if !ok || interfaceIsNil(client) {
		return ContainerStatsCollection{}, ErrResourceCapabilityUnsupported
	}
	if err := validateEngine(req.Engine); err != nil {
		return ContainerStatsCollection{}, err
	}
	samples, err := client.StatsMany(ctx, req.Engine)
	if err != nil {
		return ContainerStatsCollection{}, err
	}
	return ContainerStatsCollection{SampledAtUnixMs: time.Now().UnixMilli(), Samples: samples}, nil
}

func (a *Adapter) RawContainerInspect(ctx context.Context, req ContainerInspectRequest) (json.RawMessage, error) {
	client, ok := a.client.(resourceReadClient)
	if !ok || interfaceIsNil(client) {
		return nil, ErrResourceCapabilityUnsupported
	}
	if err := validateEngine(req.Engine); err != nil {
		return nil, err
	}
	if err := validateContainerIdentifier(req.ContainerID); err != nil {
		return nil, err
	}
	return client.RawInspectContainer(ctx, req.Engine, strings.TrimSpace(req.ContainerID))
}

func (a *Adapter) ListContainerFiles(ctx context.Context, req ContainerFileRequest) (ResourceFileListing, error) {
	client, ok := a.client.(resourceReadClient)
	if !ok || interfaceIsNil(client) {
		return ResourceFileListing{}, ErrResourceCapabilityUnsupported
	}
	clean, err := validateResourceFilePath(req.Path)
	if err != nil {
		return ResourceFileListing{}, err
	}
	if err := validateContainerIdentifier(req.ContainerID); err != nil {
		return ResourceFileListing{}, err
	}
	raw, err := client.ContainerArchive(ctx, req.Engine, strings.TrimSpace(req.ContainerID), clean)
	if err != nil {
		return ResourceFileListing{}, err
	}
	return parseResourceArchiveListing(raw, clean)
}

func (a *Adapter) ReadContainerFile(ctx context.Context, req ContainerFileRequest) (ResourceFileContent, error) {
	client, ok := a.client.(resourceReadClient)
	if !ok || interfaceIsNil(client) {
		return ResourceFileContent{}, ErrResourceCapabilityUnsupported
	}
	clean, err := validateResourceFilePath(req.Path)
	if err != nil {
		return ResourceFileContent{}, err
	}
	if err := validateContainerIdentifier(req.ContainerID); err != nil {
		return ResourceFileContent{}, err
	}
	raw, err := client.ContainerArchive(ctx, req.Engine, strings.TrimSpace(req.ContainerID), clean)
	if err != nil {
		return ResourceFileContent{}, err
	}
	return parseResourceArchiveContent(raw, clean)
}

func (a *Adapter) ListVolumeFiles(ctx context.Context, req VolumeFileRequest) (ResourceFileListing, error) {
	if req.Engine != EnginePodman {
		return ResourceFileListing{}, ErrResourceCapabilityUnsupported
	}
	client, ok := a.client.(resourceReadClient)
	if !ok || interfaceIsNil(client) {
		return ResourceFileListing{}, ErrResourceCapabilityUnsupported
	}
	clean, err := validateResourceFilePath(req.Path)
	if err != nil {
		return ResourceFileListing{}, err
	}
	if err := validateVolumeName(req.Name); err != nil {
		return ResourceFileListing{}, err
	}
	if streaming, ok := a.client.(volumeArchiveStreamClient); ok && !interfaceIsNil(streaming) {
		var listing ResourceFileListing
		err = streaming.StreamVolumeArchive(ctx, req.Engine, strings.TrimSpace(req.Name), func(reader io.Reader) error {
			listing, err = parseResourceArchiveListingExactReader(reader, clean)
			return err
		})
		return listing, err
	}
	raw, err := client.VolumeArchive(ctx, req.Engine, strings.TrimSpace(req.Name))
	if err != nil {
		return ResourceFileListing{}, err
	}
	return parseResourceArchiveListingExactReader(bytes.NewReader(raw), clean)
}

func (a *Adapter) ReadVolumeFile(ctx context.Context, req VolumeFileRequest) (ResourceFileContent, error) {
	if req.Engine != EnginePodman {
		return ResourceFileContent{}, ErrResourceCapabilityUnsupported
	}
	client, ok := a.client.(resourceReadClient)
	if !ok || interfaceIsNil(client) {
		return ResourceFileContent{}, ErrResourceCapabilityUnsupported
	}
	clean, err := validateResourceFilePath(req.Path)
	if err != nil {
		return ResourceFileContent{}, err
	}
	if err := validateVolumeName(req.Name); err != nil {
		return ResourceFileContent{}, err
	}
	if streaming, ok := a.client.(volumeArchiveStreamClient); ok && !interfaceIsNil(streaming) {
		var content ResourceFileContent
		err = streaming.StreamVolumeArchive(ctx, req.Engine, strings.TrimSpace(req.Name), func(reader io.Reader) error {
			content, err = parseResourceArchiveExactContent(reader, clean)
			return err
		})
		return content, err
	}
	raw, err := client.VolumeArchive(ctx, req.Engine, strings.TrimSpace(req.Name))
	if err != nil {
		return ResourceFileContent{}, err
	}
	return parseResourceArchiveExactContent(bytes.NewReader(raw), clean)
}

func validateResourceFilePath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "/"
	}
	if len(value) > 4096 || !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\x00\r\n") {
		return "", errors.New("resource file path is invalid")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return "", errors.New("resource file path is invalid")
		}
	}
	clean := path.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", errors.New("resource file path is invalid")
	}
	return clean, nil
}

type archiveEntry struct {
	header *tar.Header
	name   string
}

func safeArchiveEntries(raw []byte) ([]archiveEntry, error) {
	return safeArchiveEntriesReader(bytes.NewReader(raw))
}

func safeArchiveEntriesReader(source io.Reader) ([]archiveEntry, error) {
	reader := tar.NewReader(source)
	entries := make([]archiveEntry, 0, 32)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errors.New("container resource archive is invalid")
		}
		name, err := safeArchiveHeader(header)
		if err != nil {
			return nil, err
		}
		copyHeader := *header
		entries = append(entries, archiveEntry{header: &copyHeader, name: name})
		if len(entries) > maxResourceFileEntries*8 {
			return nil, ErrResourceFileLimit
		}
	}
	return entries, nil
}

func safeArchiveHeader(header *tar.Header) (string, error) {
	name := strings.TrimPrefix(path.Clean(strings.TrimSpace(header.Name)), "./")
	if name == "." {
		name = ""
	}
	if strings.HasPrefix(header.Name, "/") || name == ".." || strings.HasPrefix(name, "../") || strings.ContainsAny(name, "\x00\r\n") {
		return "", errors.New("container resource archive path is invalid")
	}
	if header.Typeflag == tar.TypeSymlink || header.Typeflag == tar.TypeLink {
		linkName := strings.TrimSpace(header.Linkname)
		resolved := path.Clean(path.Join(path.Dir(name), linkName))
		if linkName == "" || strings.HasPrefix(linkName, "/") || strings.ContainsAny(linkName, "\x00\r\n") || resolved == ".." || strings.HasPrefix(resolved, "../") {
			return "", errors.New("container resource archive link is invalid")
		}
	}
	return name, nil
}

func parseResourceArchiveListing(raw []byte, requested string) (ResourceFileListing, error) {
	return parseResourceArchiveListingReader(bytes.NewReader(raw), requested)
}

func parseResourceArchiveListingReader(reader io.Reader, requested string) (ResourceFileListing, error) {
	return parseResourceArchiveListingWithMode(reader, requested, true)
}

func parseResourceArchiveListingExactReader(reader io.Reader, requested string) (ResourceFileListing, error) {
	return parseResourceArchiveListingWithMode(reader, requested, false)
}

func parseResourceArchiveListingWithMode(reader io.Reader, requested string, wrapped bool) (ResourceFileListing, error) {
	entries, err := safeArchiveEntriesReader(reader)
	if err != nil {
		return ResourceFileListing{}, err
	}
	base := ""
	if wrapped {
		base = archiveBase(entries, requested)
	}
	byName := make(map[string]ResourceFileEntry)
	for _, item := range entries {
		relative := archiveRelative(item.name, base, requested)
		if relative == "" {
			continue
		}
		part := strings.SplitN(relative, "/", 2)[0]
		if part == "" {
			continue
		}
		entryPath := path.Join(requested, part)
		kind := archiveKind(item.header.Typeflag)
		if strings.Contains(relative, "/") {
			kind = "directory"
		}
		candidate := ResourceFileEntry{Name: part, Path: entryPath, Kind: kind, SizeBytes: item.header.Size, Mode: item.header.FileInfo().Mode().String(), ModifiedAtUnixMs: item.header.ModTime.UnixMilli()}
		if current, exists := byName[part]; !exists || current.Kind != "directory" {
			byName[part] = candidate
		}
		if len(byName) >= maxResourceFileEntries {
			break
		}
	}
	out := ResourceFileListing{Path: requested, Entries: make([]ResourceFileEntry, 0, len(byName)), Truncated: len(byName) >= maxResourceFileEntries}
	for _, item := range byName {
		out.Entries = append(out.Entries, item)
	}
	sort.Slice(out.Entries, func(i, j int) bool {
		if out.Entries[i].Kind != out.Entries[j].Kind {
			return out.Entries[i].Kind == "directory"
		}
		return strings.ToLower(out.Entries[i].Name) < strings.ToLower(out.Entries[j].Name)
	})
	return out, nil
}

func parseResourceArchiveExactContent(source io.Reader, requested string) (ResourceFileContent, error) {
	requestedRelative := strings.TrimPrefix(path.Clean(requested), "/")
	reader := tar.NewReader(source)
	var content *ResourceFileContent
	entryCount := 0
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return ResourceFileContent{}, errors.New("container resource archive is invalid")
		}
		entryCount++
		if entryCount > maxResourceFileEntries*8 {
			return ResourceFileContent{}, ErrResourceFileLimit
		}
		name, err := safeArchiveHeader(header)
		if err != nil {
			return ResourceFileContent{}, err
		}
		if name != requestedRelative {
			continue
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			return ResourceFileContent{}, errors.New("resource file type is not readable")
		}
		if header.Size > maxResourceFileBytes {
			return ResourceFileContent{}, ErrResourceFileLimit
		}
		data, err := io.ReadAll(io.LimitReader(reader, maxResourceFileBytes+1))
		if err != nil || len(data) > maxResourceFileBytes {
			return ResourceFileContent{}, ErrResourceFileLimit
		}
		fileName := path.Base(requested)
		mediaType := mime.TypeByExtension(path.Ext(fileName))
		if mediaType == "" {
			mediaType = "application/octet-stream"
		}
		value := ResourceFileContent{Name: fileName, MediaType: mediaType, Data: data}
		content = &value
	}
	if content == nil {
		return ResourceFileContent{}, errors.New("resource file was not found in archive")
	}
	return *content, nil
}

func parseResourceArchiveContent(raw []byte, requested string) (ResourceFileContent, error) {
	entries, err := safeArchiveEntries(raw)
	if err != nil {
		return ResourceFileContent{}, err
	}
	requestedRelative := strings.TrimPrefix(path.Clean(requested), "/")
	target := ""
	regular := make([]archiveEntry, 0, 1)
	for _, item := range entries {
		if item.header.Typeflag != tar.TypeReg && item.header.Typeflag != tar.TypeRegA {
			continue
		}
		regular = append(regular, item)
		if item.name == requestedRelative {
			target = item.name
		}
	}
	// Docker and Podman container cp wrap a single copied file under its base
	// name. Only accept that shortened form when the archive has one regular
	// file, so a full volume export can never return an unrelated first entry.
	if target == "" && len(regular) == 1 && path.Base(regular[0].name) == path.Base(requestedRelative) {
		target = regular[0].name
	}
	if target == "" {
		return ResourceFileContent{}, errors.New("resource file was not found in archive")
	}

	reader := tar.NewReader(bytes.NewReader(raw))
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return ResourceFileContent{}, errors.New("container resource archive is invalid")
		}
		name := strings.TrimPrefix(path.Clean(strings.TrimSpace(header.Name)), "./")
		if strings.HasPrefix(header.Name, "/") || name == ".." || strings.HasPrefix(name, "../") {
			return ResourceFileContent{}, errors.New("container resource archive path is invalid")
		}
		if name != target {
			continue
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			return ResourceFileContent{}, errors.New("resource file type is not readable")
		}
		if header.Size > maxResourceFileBytes {
			return ResourceFileContent{}, ErrResourceFileLimit
		}
		data, err := io.ReadAll(io.LimitReader(reader, maxResourceFileBytes+1))
		if err != nil || len(data) > maxResourceFileBytes {
			return ResourceFileContent{}, ErrResourceFileLimit
		}
		fileName := path.Base(requested)
		if fileName == "." || fileName == "/" {
			fileName = path.Base(name)
		}
		mediaType := mime.TypeByExtension(path.Ext(fileName))
		if mediaType == "" {
			mediaType = "application/octet-stream"
		}
		return ResourceFileContent{Name: fileName, MediaType: mediaType, Data: data}, nil
	}
	return ResourceFileContent{}, errors.New("resource file was not found in archive")
}

func archiveBase(entries []archiveEntry, requested string) string {
	if len(entries) == 0 {
		return ""
	}
	first := entries[0].name
	if first == "" {
		return ""
	}
	if entries[0].header.Typeflag == tar.TypeDir {
		return strings.TrimSuffix(first, "/")
	}
	if path.Base(requested) == path.Base(first) {
		return path.Dir(first)
	}
	return ""
}

func archiveRelative(name, base, requested string) string {
	if base != "" {
		if name == base {
			return ""
		}
		if strings.HasPrefix(name, base+"/") {
			return strings.TrimPrefix(name, base+"/")
		}
	}
	requestedRelative := strings.TrimPrefix(path.Clean(requested), "/")
	if requestedRelative != "" && requestedRelative != "." {
		if name == requestedRelative {
			return ""
		}
		if strings.HasPrefix(name, requestedRelative+"/") {
			return strings.TrimPrefix(name, requestedRelative+"/")
		}
	}
	return name
}

func archiveKind(flag byte) string {
	switch flag {
	case tar.TypeDir:
		return "directory"
	case tar.TypeSymlink, tar.TypeLink:
		return "link"
	default:
		return "file"
	}
}

func (c *CLIClient) StatsMany(ctx context.Context, engine Engine) ([]ContainerStats, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	raw, err := c.run(ctx, engine, "stats", "--no-stream", "--format", "json")
	if err != nil {
		return nil, err
	}
	var values []statsRecord
	if err := decodeJSONLines(raw, &values); err != nil {
		return nil, fmt.Errorf("parse container stats: %w", err)
	}
	out := make([]ContainerStats, 0, len(values))
	for _, value := range values {
		memory, limit := parsePairBytes(value.MemUsage)
		rx, tx := parsePairBytes(value.NetIO)
		out = append(out, ContainerStats{ContainerID: firstNonEmpty(value.ID, value.Id, value.CID), CPUPercent: parsePercent(value.CPUPerc, value.CPU), MemoryBytes: memory, MemoryLimit: limit, NetworkRxBytes: rx, NetworkTxBytes: tx})
	}
	return out, nil
}

func (c *CLIClient) RawInspectContainer(ctx context.Context, engine Engine, containerID string) (json.RawMessage, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	if err := validateContainerIdentifier(containerID); err != nil {
		return nil, err
	}
	raw, err := c.run(ctx, engine, "inspect", strings.TrimSpace(containerID))
	if err != nil {
		return nil, err
	}
	if !json.Valid(raw) {
		return nil, errors.New("container inspect returned invalid json")
	}
	return json.RawMessage(append([]byte(nil), raw...)), nil
}

func (c *CLIClient) ContainerArchive(ctx context.Context, engine Engine, containerID, filePath string) ([]byte, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	if err := validateContainerIdentifier(containerID); err != nil {
		return nil, err
	}
	clean, err := validateResourceFilePath(filePath)
	if err != nil {
		return nil, err
	}
	return c.run(ctx, engine, "cp", strings.TrimSpace(containerID)+":"+clean, "-")
}

func (c *CLIClient) VolumeArchive(ctx context.Context, engine Engine, name string) ([]byte, error) {
	if engine != EnginePodman {
		return nil, ErrResourceCapabilityUnsupported
	}
	if err := validateVolumeName(name); err != nil {
		return nil, err
	}
	return c.run(ctx, engine, "volume", "export", strings.TrimSpace(name))
}

func (c *CLIClient) StreamVolumeArchive(ctx context.Context, engine Engine, name string, consume func(io.Reader) error) error {
	if engine != EnginePodman {
		return ErrResourceCapabilityUnsupported
	}
	if err := validateVolumeName(name); err != nil {
		return err
	}
	return c.streamOutput(ctx, engine, []string{"volume", "export", strings.TrimSpace(name)}, consume)
}
