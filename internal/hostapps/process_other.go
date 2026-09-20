//go:build !unix

package hostapps

import (
	"context"
	"os/exec"
)

func configureProcess(cmd *exec.Cmd) {}
func stopProcess(ctx context.Context, cmd *exec.Cmd, done <-chan struct{}) error {
	return ErrUnavailable
}
