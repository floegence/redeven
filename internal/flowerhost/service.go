package flowerhost

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

const hostEndpointID = "flower-host"

type ServiceOptions struct {
	Logger         *slog.Logger
	Paths          Paths
	Identity       HostIdentity
	SecretResolver SecretResolver
	AgentHomeDir   string
	Shell          string
}

type Service struct {
	log      *slog.Logger
	paths    Paths
	identity HostIdentity
	store    *ConfigStore
	resolver SecretResolver
	router   *Router
	ai       *ai.Service
}

func NewService(ctx context.Context, opts ServiceOptions) (*Service, error) {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	if strings.TrimSpace(opts.Paths.StateDir) == "" {
		return nil, errors.New("missing Flower Host state directory")
	}
	store := NewConfigStore(opts.Paths)
	identity := normalizeIdentity(opts.Identity)
	if strings.TrimSpace(identity.HostID) == "" {
		loaded, err := store.LoadIdentity(ctx)
		if err != nil {
			return nil, err
		}
		identity = loaded
	}
	doc, err := store.LoadConfig(ctx)
	if err != nil {
		return nil, err
	}
	cfg, err := doc.AIConfig()
	if err != nil {
		return nil, err
	}
	agentHomeDir := strings.TrimSpace(opts.AgentHomeDir)
	if agentHomeDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		agentHomeDir = home
	}
	scope, err := filesystemscope.NewDefaultRegistry(agentHomeDir)
	if err != nil {
		return nil, err
	}
	resolver := opts.SecretResolver
	catalog := NewTargetCatalog(store)
	connector := NewTargetConnector(TargetConnectorOptions{
		HostID: strings.TrimSpace(identity.HostID),
		ResolveAccessToken: func(ctx context.Context, providerOrigin string) (string, bool, error) {
			if resolver == nil {
				return "", false, nil
			}
			return resolver.ResolveControlPlaneAccessToken(ctx, providerOrigin)
		},
	})
	aiSvc, err := ai.NewService(ai.Options{
		Logger:          logger,
		StateDir:        opts.Paths.StateDir,
		AgentHomeDir:    agentHomeDir,
		Shell:           opts.Shell,
		FilesystemScope: scope,
		Config:          cfg,
		ToolTargetPolicy: ai.ToolTargetPolicy{
			Mode: ai.ToolTargetModeExplicitTarget,
		},
		TargetToolExecutor: NewTargetExecutor(TargetExecutorOptions{
			Catalog:   catalog,
			Connector: connector,
		}),
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if resolver == nil {
				return "", false, nil
			}
			return resolver.ResolveProviderAPIKey(context.Background(), providerID)
		},
		ResolveWebSearchProviderAPIKey: func(providerID string) (string, bool, error) {
			if resolver == nil {
				return "", false, nil
			}
			return resolver.ResolveWebSearchProviderAPIKey(context.Background(), providerID)
		},
	})
	if err != nil {
		return nil, err
	}
	svc := &Service{
		log:      logger,
		paths:    opts.Paths,
		identity: identity,
		store:    store,
		resolver: resolver,
		router:   NewRouter(identity),
		ai:       aiSvc,
	}
	svc.refreshRouterHealth(ctx, doc)
	return svc, nil
}

func (s *Service) Close() error {
	if s == nil || s.ai == nil {
		return nil
	}
	return s.ai.Close()
}

func (s *Service) Meta() *session.Meta {
	return &session.Meta{
		ChannelID:         "flower-host-loopback",
		EndpointID:        hostEndpointID,
		FloeApp:           "com.floegence.redeven.flower",
		SessionKind:       "flower_host",
		UserPublicID:      strings.TrimSpace(s.identity.UserPublicID),
		UserEmail:         "",
		NamespacePublicID: "flower-host",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CreatedAtUnixMs:   s.identity.CreatedAtUnixMs,
	}
}

func (s *Service) LoadSettings(ctx context.Context) (SettingsSnapshot, error) {
	if s == nil {
		return SettingsSnapshot{}, errors.New("nil Flower Host service")
	}
	doc, err := s.store.LoadConfig(ctx)
	if err != nil {
		return SettingsSnapshot{}, err
	}
	secrets, err := ProviderSecretStates(ctx, doc.Providers, s.resolver)
	if err != nil {
		return SettingsSnapshot{}, err
	}
	cache, err := s.store.LoadTargetCache(ctx)
	if err != nil {
		return SettingsSnapshot{}, err
	}
	return SettingsSnapshot{
		Config:          doc,
		ProviderSecrets: secrets,
		TargetCache:     cache,
	}, nil
}

func (s *Service) SaveSettings(ctx context.Context, draft SettingsDraft) (SettingsSnapshot, error) {
	if s == nil {
		return SettingsSnapshot{}, errors.New("nil Flower Host service")
	}
	next, err := normalizeConfigDocument(draft.Config)
	if err != nil {
		return SettingsSnapshot{}, err
	}
	cfg, err := next.AIConfig()
	if err != nil {
		return SettingsSnapshot{}, err
	}
	if err := s.ai.UpdateConfig(cfg, func() error {
		_, saveErr := s.store.SaveConfig(ctx, next)
		return saveErr
	}); err != nil {
		return SettingsSnapshot{}, err
	}
	s.refreshRouterHealth(ctx, next)
	return s.LoadSettings(ctx)
}

func (s *Service) Resolve(ctx context.Context, req ResolveRequest) (RouterDecision, error) {
	if err := s.refreshRouterHealthFromStore(ctx); err != nil {
		return RouterDecision{}, err
	}
	return s.router.Resolve(req)
}

func (s *Service) SwitchHandler(ctx context.Context, req HandlerSwitchRequest) (RouterDecision, error) {
	if err := s.refreshRouterHealthFromStore(ctx); err != nil {
		return RouterDecision{}, err
	}
	return s.router.Switch(req)
}

func (s *Service) ListThreads(ctx context.Context) (ListThreadsResponse, error) {
	if s == nil {
		return ListThreadsResponse{}, errors.New("nil Flower Host service")
	}
	list, err := s.ai.ListThreads(ctx, s.Meta(), 200, "")
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ListThreadsResponse{Threads: []ThreadSnapshot{}}, nil
		}
		return ListThreadsResponse{}, err
	}
	out := ListThreadsResponse{Threads: make([]ThreadSnapshot, 0, len(list.Threads))}
	for _, view := range list.Threads {
		snapshot, err := s.threadListSnapshot(ctx, &view)
		if err != nil {
			return ListThreadsResponse{}, err
		}
		out.Threads = append(out.Threads, snapshot)
	}
	return out, nil
}

func (s *Service) GetThread(ctx context.Context, threadID string) (ThreadSnapshot, error) {
	if s == nil {
		return ThreadSnapshot{}, errors.New("nil Flower Host service")
	}
	return s.threadSnapshot(ctx, threadID, nil)
}

func (s *Service) SendChat(ctx context.Context, req ChatSendRequest) (SendChatResponse, error) {
	if s == nil {
		return SendChatResponse{}, errors.New("nil Flower Host service")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		created, failure, err := s.CreateThread(ctx, ThreadCreateRequest{
			DecisionID:        req.DecisionID,
			DecisionRevision:  req.DecisionRevision,
			SelectedHandlerID: req.SelectedHandlerID,
			ThreadKind:        firstNonEmpty(req.ThreadKind, ThreadKindChat),
			PrimaryTargetID:   req.PrimaryTargetID,
			InitialMessage:    req.Prompt,
			ContextEnvelope:   req.ContextEnvelope,
			ClientSurface:     firstNonEmpty(req.ClientSurface, ClientSurfaceFlowerSurface),
		})
		if err != nil {
			return SendChatResponse{}, err
		}
		if failure != nil {
			return SendChatResponse{CreateFailure: failure}, nil
		}
		return SendChatResponse{Thread: created}, nil
	}

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return SendChatResponse{}, errors.New("Flower prompt is required")
	}
	if failure, err := s.ensureThreadOwnedForSend(ctx, threadID); err != nil || failure != nil {
		if failure != nil {
			return SendChatResponse{CreateFailure: failure}, nil
		}
		return SendChatResponse{}, err
	}
	if err := s.validateContextActionForSend(ctx, threadID, req); err != nil {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:    ThreadKindChat,
			ClientSurface: ClientSurfaceFlowerSurface,
		})
		return SendChatResponse{CreateFailure: newCreateFailure(ThreadCreateErrorInvalidContext, err.Error(), &fresh)}, nil
	}
	input, err := runInputFromChatRequest(req)
	if err != nil {
		return SendChatResponse{}, err
	}
	if _, err := s.ai.SendUserTurn(ctx, s.Meta(), ai.SendUserTurnRequest{
		ThreadID: threadID,
		Input:    input,
		Options: ai.RunOptions{
			MaxSteps:      24,
			ToolAllowlist: flowerHostToolAllowlist(),
		},
	}); err != nil {
		return SendChatResponse{}, err
	}
	snapshot, err := s.threadSnapshot(ctx, threadID, nil)
	if err != nil {
		return SendChatResponse{}, err
	}
	return SendChatResponse{Thread: snapshot}, nil
}

func (s *Service) CreateThread(ctx context.Context, req ThreadCreateRequest) (ThreadSnapshot, *ThreadCreateFailure, error) {
	decision, failure, err := s.validateCreateRequest(ctx, req)
	if err != nil || failure != nil {
		return ThreadSnapshot{}, failure, err
	}
	prompt := strings.TrimSpace(req.InitialMessage)
	if prompt == "" {
		return ThreadSnapshot{}, nil, errors.New("Flower prompt is required")
	}
	thread, err := s.ai.CreateThread(ctx, s.Meta(), promptTitle(prompt), "", "", "")
	if err != nil {
		return ThreadSnapshot{}, nil, err
	}
	if err := s.persistThreadOwnership(ctx, thread.ThreadID, req, decision); err != nil {
		_ = s.ai.DeleteThread(ctx, s.Meta(), thread.ThreadID, true)
		return ThreadSnapshot{}, nil, err
	}
	input, err := runInputFromCreateRequest(req)
	if err != nil {
		return ThreadSnapshot{}, nil, err
	}
	if _, err := s.ai.SendUserTurn(ctx, s.Meta(), ai.SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Input:    input,
		Options: ai.RunOptions{
			MaxSteps:      24,
			ToolAllowlist: flowerHostToolAllowlist(),
		},
	}); err != nil {
		_ = s.ai.DeleteThread(ctx, s.Meta(), thread.ThreadID, true)
		return ThreadSnapshot{}, nil, err
	}
	snapshot, err := s.threadSnapshot(ctx, thread.ThreadID, thread)
	if err != nil {
		return ThreadSnapshot{}, nil, err
	}
	return snapshot, nil, nil
}

func (s *Service) persistThreadOwnership(ctx context.Context, threadID string, req ThreadCreateRequest, decision RouterDecision) error {
	if s == nil || s.ai == nil {
		return errors.New("nil Flower Host service")
	}
	selected := decision.SelectedHandler
	if selected == nil {
		return errors.New("missing selected Flower handler")
	}
	contextJSON := "{}"
	if req.ContextEnvelope != nil && len(req.ContextEnvelope.Raw) > 0 {
		contextJSON = string(req.ContextEnvelope.Raw)
	}
	actionJSON := contextJSON
	activeTargets := make([]string, 0, 1)
	primaryTargetID := optionalStringValue(req.PrimaryTargetID)
	if primaryTargetID != "" {
		activeTargets = append(activeTargets, primaryTargetID)
	}
	activeTargetsJSON, err := json.Marshal(activeTargets)
	if err != nil {
		return err
	}
	return s.ai.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
		EndpointID:          hostEndpointID,
		ThreadID:            strings.TrimSpace(threadID),
		OwnerKind:           "thread_home",
		OwnerID:             strings.TrimSpace(selected.HandlerID),
		ContextJSON:         contextJSON,
		ActionJSON:          actionJSON,
		HomeHostID:          strings.TrimSpace(selected.HandlerID),
		HomeHostKind:        strings.TrimSpace(selected.HandlerKind),
		OriginEnvPublicID:   originEnvPublicID(req),
		PrimaryTargetID:     primaryTargetID,
		ActiveTargetIDsJSON: string(activeTargetsJSON),
		UpdatedAtUnixMs:     unixMs(),
	})
}

func (s *Service) validateCreateRequest(ctx context.Context, req ThreadCreateRequest) (RouterDecision, *ThreadCreateFailure, error) {
	if err := s.refreshRouterHealthFromStore(ctx); err != nil {
		return RouterDecision{}, nil, err
	}
	decisionID := strings.TrimSpace(req.DecisionID)
	selectedHandlerID := strings.TrimSpace(req.SelectedHandlerID)
	if decisionID == "" || req.DecisionRevision <= 0 || selectedHandlerID == "" || strings.TrimSpace(req.ClientSurface) == "" {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:      req.ThreadKind,
			ClientSurface:   req.ClientSurface,
			PrimaryTargetID: req.PrimaryTargetID,
		})
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorSelectionStale, "Flower handler selection is required before creating a thread.", &fresh), nil
	}
	decision, ok := s.router.Latest(decisionID)
	if !ok {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:      req.ThreadKind,
			ClientSurface:   req.ClientSurface,
			PrimaryTargetID: req.PrimaryTargetID,
		})
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorSelectionStale, "Flower handler selection is no longer current.", &fresh), nil
	}
	if decision.DecisionRevision != req.DecisionRevision {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:      req.ThreadKind,
			ClientSurface:   req.ClientSurface,
			PrimaryTargetID: req.PrimaryTargetID,
		})
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorRevisionExpired, "Flower handler selection is no longer current.", &fresh), nil
	}
	expectedScope := DecisionScope{
		ThreadKind:      firstNonEmpty(req.ThreadKind, ThreadKindChat),
		ClientSurface:   strings.TrimSpace(req.ClientSurface),
		PrimaryTargetID: cleanOptionalString(req.PrimaryTargetID),
	}
	if req.ContextEnvelope != nil {
		id := strings.TrimSpace(req.ContextEnvelope.ID)
		if id != "" {
			expectedScope.ContextEnvelopeID = &id
		}
	}
	if !sameDecisionScope(decision.DecisionScope, expectedScope) {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:        expectedScope.ThreadKind,
			ClientSurface:     expectedScope.ClientSurface,
			PrimaryTargetID:   expectedScope.PrimaryTargetID,
			ContextEnvelopeID: expectedScope.ContextEnvelopeID,
		})
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorScopeMismatch, "Flower handler selection does not match this request.", &fresh), nil
	}
	if err := validateContextEnvelopeForCreate(req, expectedScope); err != nil {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:        expectedScope.ThreadKind,
			ClientSurface:     expectedScope.ClientSurface,
			PrimaryTargetID:   expectedScope.PrimaryTargetID,
			ContextEnvelopeID: expectedScope.ContextEnvelopeID,
		})
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorInvalidContext, err.Error(), &fresh), nil
	}
	if decision.SelectedHandler == nil || decision.SelectedHandler.HandlerID != selectedHandlerID {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:        expectedScope.ThreadKind,
			ClientSurface:     expectedScope.ClientSurface,
			PrimaryTargetID:   expectedScope.PrimaryTargetID,
			ContextEnvelopeID: expectedScope.ContextEnvelopeID,
		})
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorSelectionStale, "Flower handler selection changed before creating the thread.", &fresh), nil
	}
	freshAvailability, _ := s.router.Resolve(ResolveRequest{
		ThreadKind:         expectedScope.ThreadKind,
		ClientSurface:      expectedScope.ClientSurface,
		PrimaryTargetID:    expectedScope.PrimaryTargetID,
		ContextEnvelopeID:  expectedScope.ContextEnvelopeID,
		RequestedHandlerID: selectedHandlerID,
	})
	if freshAvailability.Route == RouteBlocked || freshAvailability.Blocker != nil || !handlerAvailable(freshAvailability.AvailableHandlers, selectedHandlerID) {
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorHandlerUnavailable, "Selected Flower handler is unavailable.", &freshAvailability), nil
	}
	if decision.Route == RouteBlocked || decision.Blocker != nil || !handlerAvailable(decision.AvailableHandlers, selectedHandlerID) {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:        expectedScope.ThreadKind,
			ClientSurface:     expectedScope.ClientSurface,
			PrimaryTargetID:   expectedScope.PrimaryTargetID,
			ContextEnvelopeID: expectedScope.ContextEnvelopeID,
		})
		return RouterDecision{}, newCreateFailure(ThreadCreateErrorHandlerUnavailable, "Selected Flower handler is unavailable.", &fresh), nil
	}
	return decision, nil, nil
}

func (s *Service) ensureThreadOwnedForSend(ctx context.Context, threadID string) (*ThreadCreateFailure, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}
	meta, err := s.ai.GetFlowerThreadMetadata(ctx, hostEndpointID, threadID)
	if err != nil {
		return nil, err
	}
	if meta == nil {
		fresh, _ := s.router.Resolve(ResolveRequest{
			ThreadKind:    ThreadKindChat,
			ClientSurface: ClientSurfaceFlowerSurface,
		})
		return newCreateFailure(ThreadCreateErrorHandlerUnavailable, "Flower thread ownership is missing.", &fresh), nil
	}
	if err := s.refreshRouterHealthFromStore(ctx); err != nil {
		return nil, err
	}
	fresh, err := s.router.Resolve(ResolveRequest{
		ThreadKind:      ThreadKindChat,
		ClientSurface:   ClientSurfaceFlowerSurface,
		PrimaryTargetID: cleanOptionalString(&meta.PrimaryTargetID),
	})
	if err != nil {
		return nil, err
	}
	if fresh.Route == RouteBlocked || fresh.Blocker != nil || fresh.SelectedHandler == nil ||
		strings.TrimSpace(fresh.SelectedHandler.HandlerID) != strings.TrimSpace(meta.HomeHostID) ||
		strings.TrimSpace(fresh.SelectedHandler.HandlerKind) != strings.TrimSpace(meta.HomeHostKind) {
		return newCreateFailure(ThreadCreateErrorHandlerUnavailable, "Selected Flower handler is unavailable.", &fresh), nil
	}
	return nil, nil
}

func (s *Service) validateContextActionForSend(ctx context.Context, threadID string, req ChatSendRequest) error {
	raw := req.ContextAction
	if len(raw) == 0 && req.ContextEnvelope != nil {
		raw = req.ContextEnvelope.Raw
	}
	if len(raw) == 0 {
		return nil
	}
	meta, err := s.ai.GetFlowerThreadMetadata(ctx, hostEndpointID, threadID)
	if err != nil {
		return err
	}
	if meta == nil {
		return errors.New("Flower thread ownership is missing.")
	}
	var payload struct {
		Target struct {
			TargetID string `json:"target_id"`
		} `json:"target"`
		ExecutionContext struct {
			SourceEnvPublicID string `json:"source_env_public_id"`
			CurrentTargetID   string `json:"current_target_id"`
		} `json:"execution_context"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return errors.New("Flower context envelope is invalid.")
	}
	allowedTargets := decodeStringArray(meta.ActiveTargetIDsJSON)
	if strings.TrimSpace(meta.PrimaryTargetID) != "" && !containsString(allowedTargets, meta.PrimaryTargetID) {
		allowedTargets = append(allowedTargets, strings.TrimSpace(meta.PrimaryTargetID))
	}
	targetID := strings.TrimSpace(payload.Target.TargetID)
	currentTargetID := strings.TrimSpace(payload.ExecutionContext.CurrentTargetID)
	if targetID == "" || currentTargetID == "" || targetID != currentTargetID {
		return errors.New("Flower context target is inconsistent.")
	}
	if !containsString(allowedTargets, targetID) {
		return errors.New("Flower context target is not part of this thread.")
	}
	if origin := strings.TrimSpace(payload.ExecutionContext.SourceEnvPublicID); origin != "" &&
		strings.TrimSpace(meta.OriginEnvPublicID) != "" && origin != strings.TrimSpace(meta.OriginEnvPublicID) {
		return errors.New("Flower context source environment does not match this thread.")
	}
	return nil
}

func (s *Service) threadListSnapshot(ctx context.Context, view *ai.ThreadView) (ThreadSnapshot, error) {
	if view == nil {
		return ThreadSnapshot{}, errors.New("missing thread view")
	}
	meta, err := s.ai.GetFlowerThreadMetadata(ctx, hostEndpointID, view.ThreadID)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	homeHostID, homeHostKind, sourceLabel, targetLabels := s.threadOwnershipLabels(meta)
	return ThreadSnapshot{
		ThreadID:     strings.TrimSpace(view.ThreadID),
		Title:        firstNonEmpty(view.Title, view.LastMessagePreview, "Untitled conversation"),
		ModelID:      strings.TrimSpace(view.ModelID),
		CreatedAtMs:  view.CreatedAtUnixMs,
		UpdatedAtMs:  maxInt64(view.UpdatedAtUnixMs, view.LastMessageAtUnixMs),
		Status:       mapRunStatus(view.RunStatus),
		Messages:     []ChatMessage{},
		HomeHostID:   homeHostID,
		HomeHostKind: homeHostKind,
		SourceLabel:  sourceLabel,
		TargetLabels: targetLabels,
	}, nil
}

func (s *Service) refreshRouterHealthFromStore(ctx context.Context) error {
	if s == nil {
		return errors.New("nil Flower Host service")
	}
	doc, err := s.store.LoadConfig(ctx)
	if err != nil {
		return err
	}
	s.refreshRouterHealth(ctx, doc)
	return nil
}

func (s *Service) refreshRouterHealth(ctx context.Context, doc ConfigDocument) {
	if s == nil || s.router == nil {
		return
	}
	health := s.runtimeHealth(ctx, doc)
	s.router.UpdateHealth(health)
}

func (s *Service) runtimeHealth(ctx context.Context, doc ConfigDocument) HostRuntimeHealth {
	if !doc.Enabled {
		return HostRuntimeHealth{
			Configured: false,
			ReasonCode: ReasonHostNotConfigured,
			Message:    "Enable Flower and configure a model provider before starting a conversation.",
		}
	}
	cfg, err := doc.AIConfig()
	if err != nil {
		return HostRuntimeHealth{
			Configured: false,
			ReasonCode: ReasonHostNotConfigured,
			Message:    err.Error(),
		}
	}
	if cfg == nil {
		return HostRuntimeHealth{
			Configured: false,
			ReasonCode: ReasonHostNotConfigured,
			Message:    "Configure a Flower model provider before starting a conversation.",
		}
	}
	providerID, _, ok := strings.Cut(strings.TrimSpace(cfg.CurrentModelID), "/")
	providerID = strings.TrimSpace(providerID)
	if !ok || providerID == "" {
		return HostRuntimeHealth{
			Configured: false,
			ReasonCode: ReasonHostNotConfigured,
			Message:    "Choose a Flower model before starting a conversation.",
		}
	}
	if s.resolver == nil {
		return HostRuntimeHealth{
			Configured: false,
			ReasonCode: ReasonHostNotConfigured,
			Message:    "Connect Flower to the local secret store before starting a conversation.",
		}
	}
	if _, ok, err := s.resolver.ResolveProviderAPIKey(ctx, providerID); err != nil {
		return HostRuntimeHealth{
			Configured: false,
			ReasonCode: ReasonHostNotConfigured,
			Message:    err.Error(),
		}
	} else if !ok {
		return HostRuntimeHealth{
			Configured: false,
			ReasonCode: ReasonHostNotConfigured,
			Message:    "Add the API key for the selected Flower provider before starting a conversation.",
		}
	}
	return HostRuntimeHealth{
		Configured: true,
		ReasonCode: ReasonHostAvailable,
	}
}

func runInputFromCreateRequest(req ThreadCreateRequest) (ai.RunInput, error) {
	return runInputFromParts(req.InitialMessage, req.ContextEnvelope, nil)
}

func runInputFromChatRequest(req ChatSendRequest) (ai.RunInput, error) {
	return runInputFromParts(req.Prompt, req.ContextEnvelope, req.ContextAction)
}

func runInputFromParts(prompt string, envelope *ContextEnvelopeHeader, actionRaw json.RawMessage) (ai.RunInput, error) {
	input := ai.RunInput{Text: strings.TrimSpace(prompt)}
	raw := actionRaw
	if len(raw) == 0 && envelope != nil {
		raw = envelope.Raw
	}
	if len(raw) == 0 {
		return input, nil
	}
	var action ai.ContextActionEnvelope
	if err := json.Unmarshal(raw, &action); err != nil {
		return ai.RunInput{}, err
	}
	input.ContextAction = &action
	return input, nil
}

func handlerAvailable(handlers []HandlerRef, handlerID string) bool {
	for _, handler := range handlers {
		if strings.TrimSpace(handler.HandlerID) == strings.TrimSpace(handlerID) && strings.TrimSpace(handler.State) == HandlerStateOnline {
			return true
		}
	}
	return false
}

func optionalStringValue(in *string) string {
	if in == nil {
		return ""
	}
	return strings.TrimSpace(*in)
}

func originEnvPublicID(req ThreadCreateRequest) string {
	if req.ContextEnvelope == nil || len(req.ContextEnvelope.Raw) == 0 {
		return ""
	}
	var payload struct {
		ExecutionContext struct {
			SourceEnvPublicID string `json:"source_env_public_id"`
			CurrentTargetID   string `json:"current_target_id"`
		} `json:"execution_context"`
	}
	if err := json.Unmarshal(req.ContextEnvelope.Raw, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.ExecutionContext.SourceEnvPublicID)
}

func validateContextEnvelopeForCreate(req ThreadCreateRequest, scope DecisionScope) error {
	clientSurface := strings.TrimSpace(scope.ClientSurface)
	requiresContext := strings.TrimSpace(scope.ThreadKind) == ThreadKindTask ||
		clientSurface == ClientSurfaceWelcomeAskFlower ||
		clientSurface == ClientSurfaceEnvAppAskFlower
	if !requiresContext {
		return nil
	}
	if req.ContextEnvelope == nil {
		return errors.New("Flower context is required before creating this thread.")
	}
	if strings.TrimSpace(req.ContextEnvelope.ID) == "" || len(req.ContextEnvelope.Raw) == 0 {
		return errors.New("Flower context envelope is incomplete.")
	}
	primaryTargetID := optionalStringValue(scope.PrimaryTargetID)
	if primaryTargetID == "" {
		return errors.New("Flower context requires a primary target.")
	}
	var payload struct {
		Target struct {
			TargetID string `json:"target_id"`
		} `json:"target"`
		ExecutionContext struct {
			SourceEnvPublicID string `json:"source_env_public_id"`
			CurrentTargetID   string `json:"current_target_id"`
		} `json:"execution_context"`
	}
	if err := json.Unmarshal(req.ContextEnvelope.Raw, &payload); err != nil {
		return errors.New("Flower context envelope is invalid.")
	}
	if strings.TrimSpace(payload.Target.TargetID) != primaryTargetID {
		return errors.New("Flower context target does not match the selected target.")
	}
	if strings.TrimSpace(payload.ExecutionContext.CurrentTargetID) != primaryTargetID {
		return errors.New("Flower execution context does not match the selected target.")
	}
	if strings.TrimSpace(payload.ExecutionContext.SourceEnvPublicID) == "" {
		return errors.New("Flower context is missing its source environment.")
	}
	return nil
}

func newCreateFailure(code string, message string, fresh *RouterDecision) *ThreadCreateFailure {
	return &ThreadCreateFailure{
		Success: false,
		Error: ThreadCreateError{
			Code:    code,
			Message: message,
		},
		FreshDecision: fresh,
		ThreadID:      nil,
	}
}

func (s *Service) threadSnapshot(ctx context.Context, threadID string, view *ai.ThreadView) (ThreadSnapshot, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ThreadSnapshot{}, errors.New("missing thread_id")
	}
	if view == nil {
		next, err := s.ai.GetThread(ctx, s.Meta(), threadID)
		if err != nil {
			return ThreadSnapshot{}, err
		}
		if next == nil {
			return ThreadSnapshot{}, sql.ErrNoRows
		}
		view = next
	}
	msgs, err := s.ai.ListThreadMessages(ctx, s.Meta(), threadID, 200, 0)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	meta, err := s.ai.GetFlowerThreadMetadata(ctx, hostEndpointID, threadID)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	homeHostID, homeHostKind, sourceLabel, targetLabels := s.threadOwnershipLabels(meta)
	return ThreadSnapshot{
		ThreadID:     view.ThreadID,
		Title:        firstNonEmpty(view.Title, view.LastMessagePreview, "Untitled conversation"),
		ModelID:      view.ModelID,
		CreatedAtMs:  view.CreatedAtUnixMs,
		UpdatedAtMs:  maxInt64(view.UpdatedAtUnixMs, view.LastMessageAtUnixMs),
		Status:       mapRunStatus(view.RunStatus),
		Messages:     decodeMessages(msgs.Messages),
		HomeHostID:   homeHostID,
		HomeHostKind: homeHostKind,
		SourceLabel:  sourceLabel,
		TargetLabels: targetLabels,
	}, nil
}

func (s *Service) threadOwnershipLabels(meta *threadstore.FlowerThreadMetadata) (string, string, string, []string) {
	homeHostID := s.identity.HostID
	homeHostKind := s.identity.HostKind
	sourceLabel := "this host"
	targetLabels := []string{}
	if meta != nil {
		if strings.TrimSpace(meta.HomeHostID) != "" {
			homeHostID = strings.TrimSpace(meta.HomeHostID)
		}
		if strings.TrimSpace(meta.HomeHostKind) != "" {
			homeHostKind = strings.TrimSpace(meta.HomeHostKind)
		}
		if strings.TrimSpace(meta.PrimaryTargetID) != "" {
			sourceLabel = "environment context"
			targetLabels = append(targetLabels, strings.TrimSpace(meta.PrimaryTargetID))
		}
		for _, targetID := range decodeStringArray(meta.ActiveTargetIDsJSON) {
			if !containsString(targetLabels, targetID) {
				targetLabels = append(targetLabels, targetID)
			}
		}
	}
	return homeHostID, homeHostKind, sourceLabel, targetLabels
}

func decodeStringArray(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !containsString(out, value) {
			out = append(out, value)
		}
	}
	return out
}

func containsString(values []string, target string) bool {
	target = strings.TrimSpace(target)
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}

func decodeMessages(values []any) []ChatMessage {
	out := make([]ChatMessage, 0, len(values))
	for _, value := range values {
		msg, ok := decodeRawMessage(value)
		if ok {
			out = append(out, msg)
		}
	}
	return out
}

func decodeRawMessage(value any) (ChatMessage, bool) {
	var raw []byte
	switch v := value.(type) {
	case json.RawMessage:
		raw = v
	case []byte:
		raw = v
	case string:
		raw = []byte(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ChatMessage{}, false
		}
		raw = b
	}
	var record struct {
		ID        string `json:"id"`
		Role      string `json:"role"`
		Status    string `json:"status"`
		Timestamp int64  `json:"timestamp"`
		Blocks    []struct {
			Type    string `json:"type"`
			Content string `json:"content"`
			Text    string `json:"text"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return ChatMessage{}, false
	}
	contentParts := make([]string, 0, len(record.Blocks))
	for _, block := range record.Blocks {
		switch strings.TrimSpace(block.Type) {
		case "markdown", "text":
			text := strings.TrimSpace(firstNonEmpty(block.Content, block.Text))
			if text != "" {
				contentParts = append(contentParts, text)
			}
		}
	}
	content := strings.TrimSpace(strings.Join(contentParts, "\n\n"))
	if strings.TrimSpace(record.ID) == "" || strings.TrimSpace(record.Role) == "" || content == "" {
		return ChatMessage{}, false
	}
	return ChatMessage{
		ID:          strings.TrimSpace(record.ID),
		Role:        strings.TrimSpace(record.Role),
		Content:     content,
		CreatedAtMs: record.Timestamp,
	}, true
}

func mapRunStatus(status string) string {
	switch ai.NormalizeRunState(status) {
	case ai.RunStateAccepted, ai.RunStateRunning, ai.RunStateRecovering, ai.RunStateFinalizing:
		return "running"
	case ai.RunStateWaitingApproval:
		return "waiting_approval"
	case ai.RunStateWaitingUser:
		return "waiting_user"
	case ai.RunStateFailed, ai.RunStateTimedOut:
		return "failed"
	case ai.RunStateSuccess:
		return "success"
	default:
		return "idle"
	}
}

func promptTitle(prompt string) string {
	prompt = strings.TrimSpace(prompt)
	runes := []rune(prompt)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return prompt
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func maxInt64(left int64, right int64) int64 {
	if left >= right {
		return left
	}
	return right
}

func flowerHostToolAllowlist() []string {
	return []string{
		"file.read",
		"file.edit",
		"file.write",
		"apply_patch",
		"terminal.exec",
		"task_complete",
		"ask_user",
		"exit_plan_mode",
		"write_todos",
	}
}
