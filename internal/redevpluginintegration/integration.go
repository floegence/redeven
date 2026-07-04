package redevpluginintegration

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/pkg/bridge"
	"github.com/floegence/redevplugin/pkg/browsersite"
	"github.com/floegence/redevplugin/pkg/capability"
	"github.com/floegence/redevplugin/pkg/cleanup"
	"github.com/floegence/redevplugin/pkg/connectivity"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/httpadapter"
	"github.com/floegence/redevplugin/pkg/installstage"
	rpobservability "github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/operation"
	"github.com/floegence/redevplugin/pkg/permissions"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/retaineddata"
	"github.com/floegence/redevplugin/pkg/secrets"
	"github.com/floegence/redevplugin/pkg/security"
	"github.com/floegence/redevplugin/pkg/settings"
	"github.com/floegence/redevplugin/pkg/storage"
	"github.com/floegence/redevplugin/pkg/stream"
)

type Options struct {
	Logger             *slog.Logger
	StateDir           string
	StateRoot          string
	ConfigPath         string
	ResolveSessionMeta func(channelID string) (*session.Meta, bool)
	Audit              *auditlog.Store
	Diagnostics        *diagnostics.Store
	Containers         *containers.Adapter
}

type Integration struct {
	handler http.Handler
	host    *host.Host
	closers []func() error
}

func New(ctx context.Context, opts Options) (*Integration, error) {
	if ctx == nil {
		ctx = context.Background()
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

	root := filepath.Join(stateAbs, "apps", "redevplugin")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	dbRoot := filepath.Join(root, "db")
	if err := os.MkdirAll(dbRoot, 0o700); err != nil {
		return nil, err
	}

	var closers []func() error
	closeOnError := func() {
		_ = closeAll(closers)
	}

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
	observability := &observabilityFanout{
		primary:     observabilityStore,
		audit:       opts.Audit,
		diagnostics: opts.Diagnostics,
	}

	operationStore, err := operation.NewSQLiteStore(ctx, filepath.Join(dbRoot, "operations.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, operationStore.Close)

	permissionsStore, err := permissions.NewSQLiteStore(ctx, filepath.Join(dbRoot, "permissions.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, permissionsStore.Close)

	securityPolicy, err := security.NewSQLitePolicyStore(ctx, filepath.Join(dbRoot, "security_policy.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, securityPolicy.Close)

	confirmationIntents, err := security.NewSQLiteConfirmationIntentStore(ctx, filepath.Join(dbRoot, "confirmation_intents.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, confirmationIntents.Close)

	settingsStore, err := settings.NewSQLiteStore(ctx, filepath.Join(dbRoot, "settings.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, settingsStore.Close)

	streamStore, err := stream.NewSQLiteStore(ctx, filepath.Join(dbRoot, "streams.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, streamStore.CloseDatabase)

	browserSiteStore, err := browsersite.NewSQLiteStore(ctx, filepath.Join(dbRoot, "browser_site.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, browserSiteStore.Close)

	retainedData, err := retaineddata.NewSQLiteStore(ctx, filepath.Join(dbRoot, "retained_data.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, retainedData.Close)

	secretStore, err := secrets.NewSQLiteStore(ctx, filepath.Join(dbRoot, "secrets.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, secretStore.Close)

	cleanupStore, err := cleanup.NewSQLiteOrchestrator(ctx, filepath.Join(dbRoot, "cleanup.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, cleanupStore.Close)

	assetStore, err := pluginpkg.NewFileAssetStore(filepath.Join(root, "assets"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	storageBroker, err := storage.NewFileBroker(filepath.Join(root, "storage"))
	if err != nil {
		closeOnError()
		return nil, err
	}

	sessionCache := newSessionPermissionCache()
	capabilities := capability.NewRegistry()
	if opts.Containers != nil {
		capabilities.Register(containers.CapabilityID, newContainersCapabilityAdapter(opts.Containers, operationStore, streamStore))
	}

	h, err := host.New(host.Adapters{
		SessionResolver:      &sessionResolver{resolve: opts.ResolveSessionMeta, configPath: opts.ConfigPath, cache: sessionCache},
		Policy:               &policyAdapter{sessions: sessionCache},
		PackageTrustVerifier: strictPackageTrustVerifier{},
		Registry:             registryStore,
		Audit:                observability,
		Diagnostics:          observability,
		Secrets:              secretStore,
		RuntimeArtifactResolver: &runtimeArtifactResolver{
			stateRoot: strings.TrimSpace(opts.StateRoot),
		},
		SurfaceTokens:       bridge.NewSurfaceTokenService(nil, bridge.SurfaceTokenOptions{}),
		Assets:              assetStore,
		InstallStages:       installStages,
		Capabilities:        capabilities,
		OperationCanceler:   &operationCanceler{containers: opts.Containers},
		Storage:             storageBroker,
		Connectivity:        connectivity.NewMemoryBroker(),
		NetworkExecutor:     connectivity.NewExecutor(connectivity.ExecutorOptions{}),
		Operations:          operationStore,
		Permissions:         permissionsStore,
		SecurityPolicy:      securityPolicy,
		ConfirmationIntents: confirmationIntents,
		Cleanup:             cleanupStore,
		RetainedData:        retainedData,
		BrowserSite:         browserSiteStore,
		Settings:            settingsStore,
		Streams:             streamStore,
	})
	if err != nil {
		closeOnError()
		return nil, err
	}

	handler := httpadapter.Handler{
		Host:        h,
		WebSecurity: webSecurityGuard{sessions: sessionCache},
	}
	return &Integration{handler: pluginHTTPHandler{next: handler, resolver: &sessionResolver{resolve: opts.ResolveSessionMeta, configPath: opts.ConfigPath, cache: sessionCache}}, host: h, closers: closers}, nil
}

func (i *Integration) Handler() http.Handler {
	if i == nil || i.handler == nil {
		return http.NotFoundHandler()
	}
	return i.handler
}

func (i *Integration) Close() error {
	if i == nil {
		return nil
	}
	if i.host != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = i.host.StopRuntime(ctx)
		cancel()
	}
	return closeAll(i.closers)
}

func closeAll(closers []func() error) error {
	var out error
	for i := len(closers) - 1; i >= 0; i-- {
		if closers[i] == nil {
			continue
		}
		if err := closers[i](); err != nil {
			out = errors.Join(out, err)
		}
	}
	return out
}
