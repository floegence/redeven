package ai

import (
	"context"
	"errors"
)

func (r *run) cleanupRunTerminalProcesses() (bool, error) {
	if r == nil || r.host.terminal == nil {
		return false, nil
	}
	processes := r.host.terminal.ProcessesForRun(r.id)
	if len(processes) == 0 {
		return false, nil
	}

	var errs []error
	settledAny := false
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	for _, proc := range processes {
		settled, err := proc.finalizePendingForRunEnd(ctx)
		if settled {
			settledAny = true
		}
		if err != nil {
			errs = append(errs, err)
		}
	}
	if !settledAny {
		return false, nil
	}
	if len(errs) > 0 {
		return true, errors.Join(errs...)
	}
	return true, nil
}
