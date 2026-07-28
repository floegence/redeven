package appserver

import (
	"context"
	"errors"
	"testing"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai"
)

type staticAIServiceProvider struct {
	service *ai.Service
}

func newStaticAIServiceProvider(service *ai.Service) AIServiceProvider {
	return staticAIServiceProvider{service: service}
}

func (p staticAIServiceProvider) AcquireAIService(ctx context.Context) (*ai.Service, context.Context, uint64, func(), error) {
	if p.service == nil {
		return nil, nil, 0, nil, ErrAIServiceUnavailable
	}
	return p.service, ctx, 1, func() {}, nil
}

func (p staticAIServiceProvider) AIReadiness() AIReadinessSnapshot {
	if p.service == nil {
		return AIReadinessSnapshot{State: AIReadinessUnavailable}
	}
	return AIReadinessSnapshot{State: AIReadinessReady}
}

func (p staticAIServiceProvider) RetryAIReadiness() error {
	return nil
}

func (p staticAIServiceProvider) UpdateAIServiceStartupOptions(AIServiceStartupOptions) {}

func openTestFloretStore(t *testing.T, path string) (*flruntime.Store, error) {
	t.Helper()
	ctx := context.Background()
	inspection, err := flruntime.InspectSQLiteStore(ctx, path)
	if err != nil {
		return nil, err
	}
	request := flruntime.SQLiteStoreOpenRequest{ExpectedState: inspection.State}
	if inspection.State == flruntime.SQLiteStoreStateCurrent {
		verification, verifyErr := flruntime.VerifySQLiteStore(ctx, path)
		if verifyErr != nil {
			return nil, verifyErr
		}
		if verification.Inspection.State != flruntime.SQLiteStoreStateCurrent || verification.Inspection.LeasePolicyState != flruntime.SQLiteStoreLeasePolicyMatches {
			return nil, errors.New("Floret test Store verification is not current")
		}
		for _, check := range verification.Checks {
			if !check.Passed {
				return nil, errors.New("Floret test Store verification failed")
			}
		}
		request.ExpectedState = verification.Inspection.State
		request.ExpectedSchema = verification.Inspection.Observed
	}
	return flruntime.OpenSQLiteStore(ctx, path, request)
}

func configureAppserverFloretTestTurnBinder(t *testing.T, store *flruntime.Store) *flruntime.TurnExecutionHostBinder {
	t.Helper()
	var turnBinder *flruntime.TurnExecutionHostBinder
	if err := flruntime.ConfigureHostCapabilities(store, func(bootstrap *flruntime.HostBootstrap) error {
		var err error
		turnBinder, err = flruntime.NewTurnExecutionHostBinder(bootstrap)
		return err
	}); err != nil {
		t.Fatalf("configure Floret test capabilities: %v", err)
	}
	return turnBinder
}

func requireAppserverFloretTurnOptions(t *testing.T, cfg flconfig.Config, options ...flruntime.TurnExecutionOption) flruntime.TurnExecutionHostOptions {
	t.Helper()
	result, err := flruntime.NewTurnExecutionHostOptions(cfg, options...)
	if err != nil {
		t.Fatalf("NewTurnExecutionHostOptions: %v", err)
	}
	return result
}
