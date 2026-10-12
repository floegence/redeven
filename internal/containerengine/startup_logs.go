package containerengine

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"time"
)

const maxStartupLogBytes = 16 * 1024 * 1024
const maxStartupLogLineBytes = 64 * 1024

var ErrStartupLogsUnavailable = errors.New("current-launch output is unavailable or exceeds its read limit")

type startupLogClient interface {
	StartupLogs(context.Context, Engine, string, string) ([]byte, error)
}

// StartupLogs returns sensitive raw output only to the managed entrance owner.
// It must never be used for user-visible diagnostics or persisted public logs.
func (a *Adapter) StartupLogs(ctx context.Context, req ContainerInspectRequest, startedAt string) ([]byte, error) {
	if err := validateEngine(req.Engine); err != nil {
		return nil, err
	}
	if err := validateContainerIdentifier(req.ContainerID); err != nil {
		return nil, err
	}
	if t, err := time.Parse(time.RFC3339Nano, startedAt); err != nil || t.IsZero() {
		return nil, ErrStartupLogsUnavailable
	}
	client, ok := a.client.(startupLogClient)
	if !ok {
		return nil, ErrStartupLogsUnavailable
	}
	return client.StartupLogs(ctx, req.Engine, req.ContainerID, startedAt)
}

func (c *CLIClient) StartupLogs(ctx context.Context, engine Engine, containerID, startedAt string) ([]byte, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	if err := validateContainerIdentifier(containerID); err != nil {
		return nil, err
	}
	if t, err := time.Parse(time.RFC3339Nano, startedAt); err != nil || t.IsZero() {
		return nil, ErrStartupLogsUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var output bytes.Buffer
	err := c.streamOutput(ctx, engine, []string{"logs", "--since", startedAt, "--tail", "all", containerID}, func(reader io.Reader) error {
		limited := &io.LimitedReader{R: reader, N: maxStartupLogBytes + 1}
		scanner := bufio.NewScanner(limited)
		scanner.Buffer(make([]byte, 4096), maxStartupLogLineBytes)
		for scanner.Scan() {
			output.WriteString(strings.TrimSuffix(scanner.Text(), "\r"))
			output.WriteByte('\n')
		}
		if scanner.Err() != nil || limited.N <= 0 {
			return ErrStartupLogsUnavailable
		}
		return nil
	})
	if err != nil {
		return nil, ErrStartupLogsUnavailable
	}
	return output.Bytes(), nil
}
