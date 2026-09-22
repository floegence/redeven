//go:build !unix

package hostapps

import (
	"os"
	"os/exec"
)

func configureProcess(cmd *exec.Cmd)                {}
func configureIndependentProcess(cmd *exec.Cmd)     {}
func lockApplicationStore(string) (*os.File, error) { return nil, ErrUnavailable }
func killProcess(cmd *exec.Cmd) error               { return cmd.Process.Kill() }
