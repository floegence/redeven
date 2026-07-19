package redevpluginintegration

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/pkg/bridge"
	"github.com/floegence/redevplugin/pkg/connectivity"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/httpadapter"
	"github.com/floegence/redevplugin/pkg/installstage"
	rpobservability "github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/operation"
	"github.com/floegence/redevplugin/pkg/plugindata"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/runtimeclient"
	"github.com/floegence/redevplugin/pkg/secrets"
	"github.com/floegence/redevplugin/pkg/security"
	"github.com/floegence/redevplugin/pkg/stream"
)

type Options struct {
	StateDir           string
	PermissionPolicy   *config.PermissionPolicy
	RuntimePath        string
	ResolveSessionMeta func(channelID string) (*session.Meta, bool)
	Audit              *auditlog.Store
	Diagnostics        *diagnostics.Store
	Containers         *containers.Adapter
}

type Integration struct {
	handler      http.Handler
	host         *host.Host
	capabilities *containersCapabilityAdapter
	closers      []func() error
}

func New(ctx context.Context, opts Options) (*Integration, error) {
	if ctx == nil {
		return nil, errors.New("context is required")
	}
	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		return nil, errors.New("missing StateDir")
	}
	stateAbs, err := filepath.Abs(stateDir)
	if err != nil {
		return nil, err
	}
	if opts.ResolveSessionMeta == nil {
		return nil, errors.New("missing ResolveSessionMeta")
	}
	if opts.PermissionPolicy == nil {
		return nil, errors.New("missing permission policy")
	}
	if err := opts.PermissionPolicy.Validate(); err != nil {
		return nil, err
	}
	if err := opts.Containers.Validate(); err != nil {
		return nil, err
	}
	packageTrustVerifier, err := newPackageTrustVerifier()
	if err != nil {
		return nil, err
	}
	releaseModule, _, err := newOfficialReleaseModule(packageTrustVerifier)
	if err != nil {
		return nil, err
	}

	root := filepath.Join(stateAbs, "apps", "redevplugin")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	dbRoot := filepath.Join(root, "db")
	if err := os.MkdirAll(dbRoot, 0o700); err != nil {
		return nil, err
	}

	var closers []func() error
	closeOnError := func() { _ = closeAll(closers) }

	registryStore, err := registry.NewSQLiteStore(ctx, filepath.Join(dbRoot, "registry.sqlite"))
	if err != nil {
		return nil, err
	}
	closers = append(closers, registryStore.Close)

	installStages, err := installstage.NewSQLiteStore(ctx, filepath.Join(dbRoot, "install_stage.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, installStages.Close)

	observabilityStore, err := rpobservability.NewSQLiteStore(ctx, filepath.Join(dbRoot, "observability.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, observabilityStore.Close)
	observability := newObservabilityAdapter(observabilityStore, opts.Audit, opts.Diagnostics)

	operationStore, err := operation.NewSQLiteStore(ctx, filepath.Join(dbRoot, "operations.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, operationStore.Close)

	confirmationIntents, err := security.NewSQLiteConfirmationIntentStore(ctx, filepath.Join(dbRoot, "confirmation_intents.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, confirmationIntents.Close)

	streamStore, err := stream.NewSQLiteStore(ctx, filepath.Join(dbRoot, "streams.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, streamStore.CloseDatabase)

	secretStore, err := secrets.NewSQLiteStore(ctx, filepath.Join(dbRoot, "secrets.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, secretStore.Close)

	runtimeLeaseReplays, err := runtimeclient.NewSQLiteRuntimeLeaseReplayStore(ctx, filepath.Join(dbRoot, "runtime_lease_replays.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, runtimeLeaseReplays.Close)

	assetStore, err := pluginpkg.NewFileAssetStore(filepath.Join(root, "assets"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	pluginData, err := plugindata.Open(ctx, filepath.Join(root, "storage"), registryStore)
	if err != nil {
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}

	sessions, err := newSessionAdapter(opts.ResolveSessionMeta, opts.PermissionPolicy)
	if err != nil {
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}
	capabilities, capabilityAdapter, err := newContainersCapabilityRegistry(opts.Containers, observability)
	if err != nil {
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}
	surfaceTokens := bridge.NewSurfaceTokenService(nil, bridge.SurfaceTokenOptions{})
	connectivityBroker := connectivity.NewMemoryBroker()
	networkExecutor := connectivity.NewExecutor(connectivity.ExecutorOptions{})
	runtimeModule, err := newOfficialRuntimeModule(runtimeModuleDependencies{
		Path:             opts.RuntimePath,
		Diagnostics:      observability,
		Assets:           assetStore,
		SurfaceTokens:    surfaceTokens,
		PluginData:       pluginData,
		Connectivity:     connectivityBroker,
		NetworkExecutor:  networkExecutor,
		LeaseReplayStore: runtimeLeaseReplays,
	})
	if err != nil {
		_ = capabilityAdapter.Close()
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}

	h, err := host.Open(ctx, host.Config{
		Core: host.CoreAdapters{
			Policy:               sessions,
			Authorization:        sessions,
			PackageTrustVerifier: packageTrustVerifier,
			Registry:             registryStore,
			Audit:                observability,
			SecurityAudit:        observabilityStore,
			Diagnostics:          observability,
			SurfaceTokens:        surfaceTokens,
			PluginData:           pluginData,
			Assets:               assetStore,
			InstallStages:        installStages,
			Operations:           operationStore,
			ConfirmationIntents:  confirmationIntents,
			Streams:              streamStore,
		},
		Release: releaseModule,
		Runtime: runtimeModule,
		Connectivity: &host.ConnectivityModule{
			Broker:          connectivityBroker,
			NetworkExecutor: networkExecutor,
		},
		Secrets:    &host.SecretsModule{Store: secretStore},
		Capability: &host.CapabilityModule{Registry: capabilities},
	})
	if err != nil {
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}

	handler, err := httpadapter.NewHandler(httpadapter.Dependencies{Host: h, Guard: sessions})
	if err != nil {
		_ = h.Close()
		closeOnError()
		return nil, err
	}
	integration := &Integration{
		handler:      handler,
		host:         h,
		capabilities: capabilityAdapter,
		closers:      closers,
	}
	return integration, nil
}

func (i *Integration) Handler() http.Handler {
	return i.handler
}

func (i *Integration) Close() error {
	if i == nil {
		return nil
	}
	var out error
	if i.capabilities != nil {
		out = errors.Join(out, i.capabilities.Close())
	}
	if i.host != nil {
		out = errors.Join(out, i.host.Close())
	}
	out = errors.Join(out, closeAll(i.closers))
	return out
}

func closeAll(closers []func() error) error {
	var out error
	for index := len(closers) - 1; index >= 0; index-- {
		if closers[index] == nil {
			continue
		}
		out = errors.Join(out, closers[index]())
	}
	return out
}
