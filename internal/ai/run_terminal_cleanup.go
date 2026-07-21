package ai

import (
	"context"
	"errors"
)

type runTerminalTerminationRequest struct {
	process *terminalProcess
	err     error
}

type runTerminalTermination struct {
	requests []runTerminalTerminationRequest
}

func (r *run) cleanupRunTerminalProcesses() (bool, error) {
	if r == nil || r.host.terminal == nil {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	return r.terminateRunTerminalProcesses(ctx)
}

func (r *run) terminateRunTerminalProcesses(ctx context.Context) (bool, error) {
	termination, requested := r.requestRunTerminalProcessTermination()
	if !requested {
		return false, nil
	}
	return true, termination.wait(ctx)
}

func (r *run) requestRunTerminalProcessTermination() (runTerminalTermination, bool) {
	if r == nil || r.host.terminal == nil {
		return runTerminalTermination{}, false
	}
	processes := r.host.terminal.ProcessesForRun(r.id)
	if len(processes) == 0 {
		return runTerminalTermination{}, false
	}
	requests := make([]runTerminalTerminationRequest, 0, len(processes))
	for _, proc := range processes {
		requests = append(requests, runTerminalTerminationRequest{process: proc, err: proc.requestTermination()})
	}
	return runTerminalTermination{requests: requests}, true
}

func (t runTerminalTermination) wait(ctx context.Context) error {
	if len(t.requests) == 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	results := make(chan error, len(t.requests))
	for _, request := range t.requests {
		request := request
		go func() {
			_, err := request.process.waitForTermination(ctx, request.err)
			results <- err
		}()
	}
	var errs []error
	for range t.requests {
		if err := <-results; err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}
