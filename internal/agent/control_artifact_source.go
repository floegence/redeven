package agent

import (
	"bytes"
	"context"
	"errors"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/config"
)

type controlArtifactSource struct {
	agent *Agent
}

func (source *controlArtifactSource) Acquire(ctx context.Context) (flowersec.ArtifactLease, *flowersec.ArtifactSourceError) {
	if source == nil || source.agent == nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(errors.New("missing control artifact source"))
	}
	cfg := source.agent.remoteConfigSnapshot()
	if cfg == nil || cfg.Direct == nil || len(cfg.Direct.ArtifactJSON) == 0 {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(errors.New("missing control artifact"))
	}
	if cfg.Direct.Spent {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(errors.New("control artifact is already spent"))
	}
	artifactJSON := append([]byte(nil), cfg.Direct.ArtifactJSON...)
	artifact, err := flowersec.ParseArtifact(artifactJSON)
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(spendCtx context.Context) error {
		return source.agent.commitControlArtifactSpend(spendCtx, cfg.BindingGeneration, artifactJSON)
	})
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	return lease, nil
}

func (a *Agent) commitControlArtifactSpend(ctx context.Context, bindingGeneration int64, artifactJSON []byte) error {
	if a == nil {
		return errors.New("missing agent")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.Direct == nil || a.cfg.BindingGeneration != bindingGeneration ||
		a.cfg.Direct.Spent || !bytes.Equal(a.cfg.Direct.ArtifactJSON, artifactJSON) {
		return errors.New("control artifact changed before spend commit")
	}
	next := *a.cfg
	direct := *a.cfg.Direct
	direct.ArtifactJSON = append([]byte(nil), a.cfg.Direct.ArtifactJSON...)
	direct.Spent = true
	next.Direct = &direct
	if err := config.Save(a.configPath, &next); err != nil {
		return err
	}
	a.cfg = &next
	return nil
}
