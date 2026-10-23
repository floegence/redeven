//go:build !darwin && !windows

package ai

func terminalExecGroupSignalError(_ int, err error) error {
	return terminalExecGroupSignalResult(err)
}
