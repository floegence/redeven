package ai

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

func (r *run) cleanupRunTerminalProcesses(host flruntime.Host) (flruntime.ThreadTurnProjection, bool, error) {
	if r == nil || r.service == nil {
		return flruntime.ThreadTurnProjection{}, false, nil
	}
	manager := r.service.terminalProcessManager()
	if manager == nil {
		return flruntime.ThreadTurnProjection{}, false, nil
	}
	processes := manager.ProcessesForRun(r.endpointID, r.threadID, r.id)
	if len(processes) == 0 {
		return flruntime.ThreadTurnProjection{}, false, nil
	}

	var errs []error
	settledAny := false
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	for _, proc := range processes {
		settled, err := proc.settlePendingForRunEnd(ctx)
		if settled {
			settledAny = true
		}
		if err != nil {
			errs = append(errs, err)
		}
	}
	if !settledAny {
		return flruntime.ThreadTurnProjection{}, false, nil
	}
	if len(errs) > 0 {
		return flruntime.ThreadTurnProjection{}, true, errors.Join(errs...)
	}
	projection, err := r.readFloretTurnProjection(ctx, host)
	if err != nil {
		return flruntime.ThreadTurnProjection{}, true, err
	}
	return projection, true, nil
}

func (r *run) readFloretTurnProjection(ctx context.Context, host flruntime.Host) (flruntime.ThreadTurnProjection, error) {
	if r == nil {
		return flruntime.ThreadTurnProjection{}, errors.New("nil run")
	}
	if host == nil {
		return flruntime.ThreadTurnProjection{}, errors.New("floret host unavailable for terminal cleanup projection")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return host.ReadTurnProjection(ctx, flruntime.ReadTurnProjectionRequest{
		ThreadID: flruntime.ThreadID(strings.TrimSpace(r.threadID)),
		TurnID:   flruntime.TurnID(strings.TrimSpace(r.messageID)),
		RunID:    flruntime.RunID(strings.TrimSpace(r.id)),
	})
}
