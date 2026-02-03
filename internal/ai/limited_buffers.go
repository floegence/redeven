package ai

import (
	"bytes"
	"io"
	"sync"
)

type combinedLimitedBuffers struct {
	max int

	mu        sync.Mutex
	used      int
	truncated bool

	stdout bytes.Buffer
	stderr bytes.Buffer
}

func newCombinedLimitedBuffers(max int) *combinedLimitedBuffers {
	if max <= 0 {
		max = 1
	}
	return &combinedLimitedBuffers{max: max}
}

func (b *combinedLimitedBuffers) Stdout() io.Writer { return limitedWriter{b: b, which: "stdout"} }
func (b *combinedLimitedBuffers) Stderr() io.Writer { return limitedWriter{b: b, which: "stderr"} }

func (b *combinedLimitedBuffers) StdoutString() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.stdout.String()
}

func (b *combinedLimitedBuffers) StderrString() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.stderr.String()
}

func (b *combinedLimitedBuffers) Truncated() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.truncated
}

type limitedWriter struct {
	b     *combinedLimitedBuffers
	which string // "stdout"|"stderr"
}

func (w limitedWriter) Write(p []byte) (int, error) {
	if w.b == nil || len(p) == 0 {
		return len(p), nil
	}

	w.b.mu.Lock()
	defer w.b.mu.Unlock()

	// Always report success to avoid blocking the child process.
	if w.b.truncated || w.b.used >= w.b.max {
		w.b.truncated = true
		return len(p), nil
	}

	remain := w.b.max - w.b.used
	n := len(p)
	if n > remain {
		n = remain
		w.b.truncated = true
	}

	if n > 0 {
		switch w.which {
		case "stderr":
			_, _ = w.b.stderr.Write(p[:n])
		default:
			_, _ = w.b.stdout.Write(p[:n])
		}
		w.b.used += n
	}

	return len(p), nil
}
