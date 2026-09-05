package containerengine

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type VolumeDiskUsage struct {
	Name      string `json:"name"`
	SizeBytes *int64 `json:"size_bytes,omitempty"`
}

type VolumeDiskUsageResponse struct {
	SampledAtUnixMs int64             `json:"sampled_at_unix_ms"`
	Volumes         []VolumeDiskUsage `json:"volumes"`
}

type volumeDiskUsageClient interface {
	VolumeDiskUsage(context.Context, Engine) ([]VolumeDiskUsage, error)
}

func (a *Adapter) VolumeDiskUsage(ctx context.Context, req VolumeListRequest) (VolumeDiskUsageResponse, error) {
	if err := validateEngine(req.Engine); err != nil {
		return VolumeDiskUsageResponse{}, err
	}
	client, ok := a.client.(volumeDiskUsageClient)
	if !ok || interfaceIsNil(client) {
		return VolumeDiskUsageResponse{}, ErrResourceCapabilityUnsupported
	}
	items, err := client.VolumeDiskUsage(ctx, req.Engine)
	if err != nil {
		return VolumeDiskUsageResponse{}, err
	}
	return VolumeDiskUsageResponse{SampledAtUnixMs: time.Now().UnixMilli(), Volumes: items}, nil
}

func (c *CLIClient) VolumeDiskUsage(ctx context.Context, engine Engine) ([]VolumeDiskUsage, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	args := []string{"system", "df", "--verbose"}
	if engine == EngineDocker {
		args = append(args, "--format", `{{json .Volumes}}`)
	}
	// Disk usage may scan large volumes; inventory does not wait for this read.
	raw, err := c.runWithTimeout(ctx, time.Minute, engine, args...)
	if err != nil {
		return nil, err
	}
	var records []struct {
		Name string
		Size string
	}
	if engine == EngineDocker {
		if err := json.Unmarshal(raw, &records); err != nil {
			return nil, errors.New("invalid volume disk usage response")
		}
	} else {
		// Podman rejects --format with --verbose. Validate its final volume table
		// explicitly so a changed layout cannot become a plausible zero size.
		_, table, found := strings.Cut(string(raw), "\nLocal Volumes space usage:\n")
		if !found {
			return nil, errors.New("volume disk usage table is unavailable")
		}
		lines := strings.Split(strings.TrimSpace(table), "\n")
		if strings.Join(strings.Fields(lines[0]), " ") != "VOLUME NAME LINKS SIZE" {
			return nil, errors.New("invalid volume disk usage header")
		}
		for _, line := range lines[1:] {
			fields := strings.Fields(line)
			if len(fields) == 0 {
				continue
			}
			if len(fields) != 3 {
				return nil, errors.New("invalid volume disk usage row")
			}
			if _, err := strconv.Atoi(fields[1]); err != nil {
				return nil, errors.New("invalid volume disk usage links")
			}
			records = append(records, struct {
				Name string
				Size string
			}{fields[0], fields[2]})
		}
	}
	items := make([]VolumeDiskUsage, 0, len(records))
	seen := make(map[string]bool, len(records))
	for _, record := range records {
		if validateVolumeName(record.Name) != nil || seen[record.Name] {
			return nil, errors.New("invalid volume disk usage identity")
		}
		seen[record.Name] = true
		items = append(items, VolumeDiskUsage{Name: record.Name, SizeBytes: parseVolumeSize(record.Size)})
	}
	return items, nil
}

var volumeSizePattern = regexp.MustCompile(`^([0-9]+(?:\.[0-9]+)?)\s*(B|kB|KB|MB|GB|TB|PB|EB|KiB|MiB|GiB|TiB|PiB|EiB)$`)

func parseVolumeSize(value string) *int64 {
	match := volumeSizePattern.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return nil
	}
	number, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return nil
	}
	unit := match[2]
	base := float64(1000)
	if strings.Contains(unit, "i") {
		base = 1024
	}
	exponent := 0
	if unit != "B" {
		exponent = strings.Index("KMGTPE", strings.ToUpper(unit[:1])) + 1
	}
	valueBytes := number * math.Pow(base, float64(exponent))
	if math.IsInf(valueBytes, 0) || valueBytes >= math.MaxInt64 {
		return nil
	}
	result := int64(valueBytes)
	return &result
}
