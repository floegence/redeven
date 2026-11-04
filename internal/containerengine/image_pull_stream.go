package containerengine

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"regexp"
	"strings"
)

type imagePullCommandStreamer interface {
	StreamImagePull(context.Context, string, []string, func([]byte) error) error
}

func (c *CLIClient) canStreamImagePull() bool {
	if c.Runner == nil {
		return true
	}
	if _, ok := c.Runner.(imagePullCommandStreamer); ok {
		return true
	}
	_, ok := c.Runner.(CommandStreamer)
	return ok
}

// Pull commands render transfer counters only when their output is a terminal.
// Keep CLI endpoint selection and credential helpers as the execution authority.
func (c *CLIClient) streamImagePull(ctx context.Context, engine Engine, args []string, sink func(context.Context, []byte) error) error {
	runner := c.Runner
	if runner == nil {
		runner = execRunner{}
	}
	streamer, ok := runner.(imagePullCommandStreamer)
	if !ok {
		return c.stream(ctx, engine, args, sink)
	}
	if c.StreamTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.StreamTimeout)
		defer cancel()
	}
	return streamer.StreamImagePull(ctx, string(engine), endpointArgs(ctx, engine, args), func(line []byte) error {
		return sink(ctx, line)
	})
}

var imagePullANSI = regexp.MustCompile(`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))`)

var imagePullBytePair = regexp.MustCompile(`([0-9]+(?:[.][0-9]+)?[[:space:]]*[kKMGTPE]?i?[bB])[[:space:]]*/[[:space:]]*([0-9]+(?:[.][0-9]+)?[[:space:]]*[kKMGTPE]?i?[bB])`)

func cleanImagePullLine(line string) string {
	line = imagePullANSI.ReplaceAllString(line, "")
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 32 && r != '\t' || r == 127 {
			return -1
		}
		return r
	}, line))
}

func readImagePullLines(reader io.Reader, sink func([]byte) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), maxLogLineBytes)
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		if index := bytes.IndexAny(data, "\r\n"); index >= 0 {
			return index + 1, data[:index], nil
		}
		if atEOF && len(data) > 0 {
			return len(data), data, nil
		}
		return 0, nil, nil
	})
	for scanner.Scan() {
		if line := cleanImagePullLine(scanner.Text()); line != "" {
			if err := sink([]byte(line)); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}
