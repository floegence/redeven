//go:build !windows

package containerengine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"

	"github.com/creack/pty"
	"github.com/floegence/redeven/internal/processenv"
)

func (execRunner) StreamImagePull(ctx context.Context, name string, args []string, sink func([]byte) error) error {
	if _, err := exec.LookPath(name); err != nil {
		return fmt.Errorf("%w: %s", ErrCLIUnavailable, name)
	}
	master, terminal, err := pty.Open()
	if err != nil {
		return errors.New("image pull progress terminal unavailable")
	}
	defer master.Close()
	defer terminal.Close()
	if err := pty.Setsize(master, &pty.Winsize{Cols: 200, Rows: 40}); err != nil {
		return errors.New("image pull progress terminal setup failed")
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = processenv.Current()
	cmd.Stdout, cmd.Stderr = terminal, terminal
	configureCommandProcessGroup(cmd)
	cmd.Cancel = func() error { return terminateCommandProcessTree(cmd) }
	if err := cmd.Start(); err != nil {
		if errors.Is(err, os.ErrPermission) {
			return ErrPermissionDenied
		}
		return errors.New("image pull command start failed")
	}
	_ = terminal.Close()
	var evidence []byte
	readErr := readImagePullLines(imagePullTerminalReader{master}, func(line []byte) error {
		// Retain the tail: terminal errors arrive after potentially long progress.
		evidence = append(evidence, line...)
		evidence = append(evidence, 10)
		if len(evidence) > maxCommandStderrBytes {
			evidence = evidence[len(evidence)-maxCommandStderrBytes:]
		}
		return sink(line)
	})
	if readErr != nil {
		_ = terminateCommandProcessTree(cmd)
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if readErr != nil {
		return readErr
	}
	if waitErr != nil {
		return classifyCommandFailure(args, waitErr, evidence)
	}
	return nil
}

type imagePullTerminalReader struct{ io.Reader }

func (r imagePullTerminalReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	// Linux signals the last terminal slave closing with EIO; Darwin uses EOF.
	if errors.Is(err, syscall.EIO) {
		err = io.EOF
	}
	return n, err
}
