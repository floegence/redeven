package flowerhost

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

const hostEndpointID = "flower-host"
const hostLocalFloeAppID = "redeven.flower.host"

type ServiceOptions struct {
	Logger         *slog.Logger
	Paths          Paths
	Identity       HostIdentity
	SecretResolver SecretResolver
	TargetBroker   TargetSessionBroker
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
	brokerURL := ""
	brokerToken := ""
	if opts.TargetBroker != nil {
		brokerURL, brokerToken = opts.TargetBroker.TargetSessionBrokerEndpoint()
	} else if endpoint, ok := resolver.(TargetSessionBroker); ok {
		brokerURL, brokerToken = endpoint.TargetSessionBrokerEndpoint()
	}
	catalog := NewTargetCatalog(store)
	connector := NewTargetConnector(TargetConnectorOptions{
		BrokerURL:   brokerURL,
		BrokerToken: brokerToken,
	})
	svc := &Service{
		log:      logger,
		paths:    opts.Paths,
		identity: identity,
		store:    store,
		resolver: resolver,
		router:   NewRouter(identity),
	}
	aiSvc, err := ai.NewService(ai.Options{
		Logger:                        logger,
		StateDir:                      opts.Paths.StateDir,
		AgentHomeDir:                  agentHomeDir,
		Shell:                         opts.Shell,
		FilesystemScope:               scope,
		ResetInvalidThreadstoreSchema: true,
		Config:                        cfg,
		ToolTargetPolicy: ai.ToolTargetPolicy{
			Mode: ai.ToolTargetModeExplicitTarget,
		},
		TargetToolExecutor: NewTargetExecutor(TargetExecutorOptions{
			Catalog:   catalog,
			Connector: connector,
		}),
		ToolTargetPolicyForRun: func(_ *session.Meta, _ threadstore.Thread, flowerMeta *threadstore.FlowerThreadMetadata) ai.ToolTargetPolicy {
			return flowerThreadToolTargetPolicy(flowerMeta)
		},
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
	svc.ai = aiSvc
	svc.refreshRouterHealth(ctx, doc)
	return svc, nil
}

func flowerThreadToolTargetPolicy(flowerMeta *threadstore.FlowerThreadMetadata) ai.ToolTargetPolicy {
	primaryTargetID := ""
	allowedTargetIDs := []string{}
	if flowerMeta != nil {
		primaryTargetID = strings.TrimSpace(flowerMeta.PrimaryTargetID)
		allowedTargetIDs = decodeStringArray(flowerMeta.ActiveTargetIDsJSON)
		if primaryTargetID != "" && !containsString(allowedTargetIDs, primaryTargetID) {
			allowedTargetIDs = append(allowedTargetIDs, primaryTargetID)
		}
	}
	if primaryTargetID == "" {
		return ai.ToolTargetPolicy{Mode: ai.ToolTargetModeLocalRuntime}
	}
	return ai.ToolTargetPolicy{
		Mode:             ai.ToolTargetModeExplicitTarget,
		DefaultTargetID:  primaryTargetID,
		AllowedTargetIDs: allowedTargetIDs,
	}
}

func (s *Service) primaryTargetIDForThread(ctx context.Context, threadID string) string {
	if s == nil || s.ai == nil {
		return ""
	}
	if ctx == nil {
		ctx = context.Background()
	}
	meta, err := s.ai.GetFlowerThreadMetadata(ctx, hostEndpointID, threadID)
	if err != nil || meta == nil {
		return ""
	}
	return strings.TrimSpace(meta.PrimaryTargetID)
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
		FloeApp:           hostLocalFloeAppID,
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

func (s *Service) CarrierHealth(ctx context.Context) CarrierHealth {
	if s == nil || s.resolver == nil {
		return CarrierHealth{State: "not_configured"}
	}
	checker, ok := s.resolver.(SecretResolverHealthChecker)
	if !ok {
		return CarrierHealth{State: "unknown"}
	}
	if err := checker.CheckSecretResolver(ctx); err != nil {
		return CarrierHealth{State: "unreachable", Error: err.Error()}
	}
	return CarrierHealth{State: "ready"}
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
	snapshot, err := s.threadSnapshot(ctx, threadID, nil)
	if errors.Is(err, sql.ErrNoRows) {
		return ThreadSnapshot{}, newServiceError(http.StatusNotFound, "thread_not_found", "thread not found")
	}
	return snapshot, err
}

func (s *Service) MutateThread(ctx context.Context, threadID string, req ThreadMutationRequest) (ThreadSnapshot, error) {
	if s == nil {
		return ThreadSnapshot{}, errors.New("nil Flower Host service")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ThreadSnapshot{}, newServiceError(http.StatusBadRequest, "missing_thread_id", "missing thread id")
	}
	if req.Title == nil && req.Pinned == nil {
		return ThreadSnapshot{}, newServiceError(http.StatusBadRequest, "invalid_request", "missing mutation field")
	}
	if req.Title != nil {
		if err := s.ai.RenameThread(ctx, s.Meta(), threadID, *req.Title); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ThreadSnapshot{}, newServiceError(http.StatusNotFound, "thread_not_found", "thread not found")
			}
			return ThreadSnapshot{}, err
		}
	}
	var view *ai.ThreadView
	if req.Pinned != nil {
		next, err := s.ai.SetThreadPinned(ctx, s.Meta(), threadID, *req.Pinned)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ThreadSnapshot{}, newServiceError(http.StatusNotFound, "thread_not_found", "thread not found")
			}
			return ThreadSnapshot{}, err
		}
		view = next
	}
	return s.threadSnapshot(ctx, threadID, view)
}

func (s *Service) ForkThread(ctx context.Context, threadID string, req ForkThreadRequest) (ThreadSnapshot, error) {
	if s == nil {
		return ThreadSnapshot{}, errors.New("nil Flower Host service")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ThreadSnapshot{}, newServiceError(http.StatusBadRequest, "missing_thread_id", "missing thread id")
	}
	view, err := s.ai.ForkThread(ctx, s.Meta(), threadID, req.Title)
	if err != nil {
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return ThreadSnapshot{}, newServiceError(http.StatusNotFound, "thread_not_found", "thread not found")
		case errors.Is(err, ai.ErrThreadForkUnavailable):
			return ThreadSnapshot{}, newServiceError(http.StatusConflict, "thread_fork_unavailable", "Flower thread cannot be forked while it is running or waiting for input.")
		default:
			return ThreadSnapshot{}, err
		}
	}
	return s.threadSnapshot(ctx, view.ThreadID, view)
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
		return SendChatResponse{Thread: &created}, nil
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
		Options:  flowerHostRunOptions(),
	}); err != nil {
		return SendChatResponse{}, err
	}
	snapshot, err := s.threadSnapshot(ctx, threadID, nil)
	if err != nil {
		return SendChatResponse{}, err
	}
	return SendChatResponse{Thread: &snapshot}, nil
}

func (s *Service) SubmitInput(ctx context.Context, req ChatSubmitInputRequest) (SubmitChatInputResponse, error) {
	if s == nil {
		return SubmitChatInputResponse{}, errors.New("nil Flower Host service")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	promptID := strings.TrimSpace(req.PromptID)
	if threadID == "" {
		return SubmitChatInputResponse{}, newServiceError(http.StatusBadRequest, "invalid_request", "missing thread_id")
	}
	if promptID == "" {
		return SubmitChatInputResponse{}, newServiceError(http.StatusBadRequest, "invalid_request", "missing prompt_id")
	}
	if failure, err := s.ensureThreadOwnedForSend(ctx, threadID); err != nil || failure != nil {
		if err != nil {
			return SubmitChatInputResponse{}, err
		}
		return SubmitChatInputResponse{}, newServiceError(http.StatusConflict, failure.Error.Code, failure.Error.Message)
	}
	response := ai.RequestUserInputResponse{
		PromptID: promptID,
		Answers:  make(map[string]ai.RequestUserInputAnswer, len(req.Answers)),
	}
	for questionID, answer := range req.Answers {
		questionID = strings.TrimSpace(questionID)
		if questionID == "" {
			continue
		}
		response.Answers[questionID] = ai.RequestUserInputAnswer{
			ChoiceID: strings.TrimSpace(answer.ChoiceID),
			Text:     strings.TrimSpace(answer.Text),
		}
	}
	if len(response.Answers) == 0 {
		return SubmitChatInputResponse{}, newServiceError(http.StatusBadRequest, "input_answer_invalid", "Flower input answer is required.")
	}
	if _, err := s.ai.SubmitRequestUserInputResponse(ctx, s.Meta(), ai.SubmitRequestUserInputResponseRequest{
		ThreadID: threadID,
		Response: response,
		Options:  flowerHostRunOptions(),
	}); err != nil {
		if errors.Is(err, ai.ErrWaitingPromptChanged) {
			return SubmitChatInputResponse{}, newServiceError(http.StatusConflict, "waiting_prompt_changed", "Flower is no longer waiting for that input.")
		}
		return SubmitChatInputResponse{}, err
	}
	snapshot, err := s.threadSnapshot(ctx, threadID, nil)
	if err != nil {
		return SubmitChatInputResponse{}, err
	}
	return SubmitChatInputResponse{Thread: &snapshot}, nil
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
	thread, err := s.ai.CreateThread(ctx, s.Meta(), "", "", "", "")
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
		Options:  flowerHostRunOptions(),
	}); err != nil {
		_ = s.ai.DeleteThread(ctx, s.Meta(), thread.ThreadID, true)
		return ThreadSnapshot{}, nil, err
	}
	snapshot, err := s.threadSnapshot(ctx, thread.ThreadID, nil)
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
	status, err := mapRunStatus(view.RunStatus)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	homeHostID, homeHostKind, sourceLabel, targetLabels := s.threadOwnershipLabels(meta)
	var inputRequest *ChatInputRequest
	var snapshotError *ChatRunError
	if status == "waiting_user" {
		inputRequest, err = mapChatInputRequest(view.WaitingPrompt)
		if err != nil {
			snapshotError = chatRunErrorFromProjection(err)
			if snapshotError == nil {
				return ThreadSnapshot{}, err
			}
			status = "failed"
		}
		if inputRequest == nil && snapshotError == nil {
			snapshotError = &ChatRunError{
				Code:    "waiting_input_contract_invalid",
				Message: "Flower thread is waiting for input, but its input request is incomplete.",
			}
			status = "failed"
		}
	}
	return ThreadSnapshot{
		ThreadID:     strings.TrimSpace(view.ThreadID),
		Title:        firstNonEmpty(view.Title, view.LastMessagePreview, "Untitled conversation"),
		ModelID:      strings.TrimSpace(view.ModelID),
		WorkingDir:   strings.TrimSpace(view.WorkingDir),
		PinnedAtMs:   view.PinnedAtUnixMs,
		CreatedAtMs:  view.CreatedAtUnixMs,
		UpdatedAtMs:  maxInt64(view.UpdatedAtUnixMs, view.LastMessageAtUnixMs),
		Status:       status,
		Messages:     []ChatMessage{},
		InputRequest: inputRequest,
		Error:        snapshotError,
		HomeHostID:   homeHostID,
		HomeHostKind: homeHostKind,
		SourceLabel:  sourceLabel,
		TargetLabels: targetLabels,
		HasUnread:    false,
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
	decoded, err := decodeMessages(msgs.Messages)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	if runID, raw, err := s.ai.GetActiveRunSnapshot(s.Meta(), threadID); err == nil && strings.TrimSpace(raw) != "" {
		activeMessage, activeActivity, visible, err := decodeRawMessage(json.RawMessage(raw))
		if err != nil {
			return ThreadSnapshot{}, fmt.Errorf("decode active Flower run snapshot: %w", err)
		}
		if visible {
			decoded = decoded.upsertMessage(activeMessage)
		}
		decoded.ToolActivity = mergeToolActivity(decoded.ToolActivity, withRunID(activeActivity, runID))
	} else if err != nil {
		return ThreadSnapshot{}, err
	}
	toolActivity, err := s.threadToolActivity(ctx, threadID)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	toolActivity = mergeToolActivity(decoded.ToolActivity, toolActivity)
	inputRequest, err := mapChatInputRequest(view.WaitingPrompt)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	toolActivity, err = projectInputRequestToolActivity(toolActivity, inputRequest)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	meta, err := s.ai.GetFlowerThreadMetadata(ctx, hostEndpointID, threadID)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	homeHostID, homeHostKind, sourceLabel, targetLabels := s.threadOwnershipLabels(meta)
	status, err := mapRunStatus(view.RunStatus)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	if status == "waiting_user" && inputRequest == nil {
		return ThreadSnapshot{}, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", "Flower thread is waiting for input, but its input request is incomplete.")
	}
	runError, err := chatRunError(view)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	return ThreadSnapshot{
		ThreadID:     view.ThreadID,
		Title:        firstNonEmpty(view.Title, view.LastMessagePreview, "Untitled conversation"),
		ModelID:      view.ModelID,
		WorkingDir:   strings.TrimSpace(view.WorkingDir),
		PinnedAtMs:   view.PinnedAtUnixMs,
		CreatedAtMs:  view.CreatedAtUnixMs,
		UpdatedAtMs:  maxInt64(maxInt64(view.UpdatedAtUnixMs, view.LastMessageAtUnixMs), latestMessageCreatedAt(decoded.Messages)),
		Status:       status,
		Messages:     decoded.Messages,
		ToolActivity: toolActivity,
		InputRequest: inputRequest,
		Error:        runError,
		HomeHostID:   homeHostID,
		HomeHostKind: homeHostKind,
		SourceLabel:  sourceLabel,
		TargetLabels: targetLabels,
		HasUnread:    false,
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

func trimStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cloneBoolPtr(value *bool) *bool {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

type decodedThreadMessages struct {
	Messages     []ChatMessage
	ToolActivity []ChatToolActivity
}

func (d decodedThreadMessages) upsertMessage(message ChatMessage) decodedThreadMessages {
	for idx, existing := range d.Messages {
		if strings.TrimSpace(existing.ID) == strings.TrimSpace(message.ID) {
			next := append([]ChatMessage(nil), d.Messages...)
			next[idx] = message
			d.Messages = next
			return d
		}
	}
	d.Messages = append(append([]ChatMessage(nil), d.Messages...), message)
	return d
}

func decodeMessages(values []any) (decodedThreadMessages, error) {
	out := decodedThreadMessages{
		Messages:     make([]ChatMessage, 0, len(values)),
		ToolActivity: []ChatToolActivity{},
	}
	for index, value := range values {
		msg, activity, visible, err := decodeRawMessage(value)
		if err != nil {
			return decodedThreadMessages{}, fmt.Errorf("decode Flower message %d: %w", index, err)
		}
		out.ToolActivity = mergeToolActivity(out.ToolActivity, activity)
		if visible {
			out.Messages = append(out.Messages, msg)
		}
	}
	return out, nil
}

func decodeRawMessage(value any) (ChatMessage, []ChatToolActivity, bool, error) {
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
			return ChatMessage{}, nil, false, fmt.Errorf("marshal message JSON: %w", err)
		}
		raw = b
	}
	var record struct {
		ID        string            `json:"id"`
		Role      string            `json:"role"`
		Status    string            `json:"status"`
		Timestamp int64             `json:"timestamp"`
		Blocks    []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return ChatMessage{}, nil, false, fmt.Errorf("parse message JSON: %w", err)
	}
	id := strings.TrimSpace(record.ID)
	role, ok := normalizeChatMessageRole(record.Role)
	if id == "" {
		return ChatMessage{}, nil, false, errors.New("message id is required")
	}
	if !ok {
		return ChatMessage{}, nil, false, fmt.Errorf("message role %q is unsupported", strings.TrimSpace(record.Role))
	}
	if record.Timestamp <= 0 {
		return ChatMessage{}, nil, false, errors.New("message timestamp must be a positive millisecond timestamp")
	}
	status, ok := normalizeChatMessageStatus(record.Status)
	if !ok {
		return ChatMessage{}, nil, false, fmt.Errorf("message status %q is unsupported", strings.TrimSpace(record.Status))
	}
	contentParts := make([]string, 0, len(record.Blocks))
	blocks := make([]ChatMessageBlock, 0, len(record.Blocks))
	activity := make([]ChatToolActivity, 0)
	hasNonTextPayload := false
	for index, block := range record.Blocks {
		var base struct {
			Type           string `json:"type"`
			Content        string `json:"content"`
			Text           string `json:"text"`
			PublicSummary  string `json:"public_summary"`
			ContainsSecret bool   `json:"contains_secret"`
		}
		if err := json.Unmarshal(block, &base); err != nil {
			return ChatMessage{}, nil, false, fmt.Errorf("parse message block %d: %w", index, err)
		}
		blockType := strings.TrimSpace(base.Type)
		switch blockType {
		case "markdown", "text":
			text := strings.TrimSpace(firstNonEmpty(base.Content, base.Text))
			if text != "" {
				contentParts = append(contentParts, text)
				blocks = append(blocks, ChatMessageBlock{Type: blockType, Content: text})
			}
		case "thinking":
			text := strings.TrimSpace(firstNonEmpty(base.Content, base.Text))
			if text != "" {
				blocks = append(blocks, ChatMessageBlock{Type: "thinking", Content: text})
			}
		case "image", "file":
			hasNonTextPayload = true
			// Valid persisted input blocks that the compact Flower transcript does not render yet.
		case "request_user_input_response":
			text := strings.TrimSpace(firstNonEmpty(base.PublicSummary, base.Content, base.Text))
			if text != "" && !base.ContainsSecret {
				contentParts = append(contentParts, text)
				blocks = append(blocks, ChatMessageBlock{Type: "text", Content: text})
			} else if base.ContainsSecret {
				hasNonTextPayload = true
			}
		case "activity-timeline":
			items, err := decodeActivityTimelineBlock(block)
			if err != nil {
				return ChatMessage{}, nil, false, fmt.Errorf("decode activity timeline block %d: %w", index, err)
			}
			activity = mergeToolActivity(activity, items)
		case "tool-call":
			item, err := decodeToolCallBlock(block)
			if err != nil {
				return ChatMessage{}, nil, false, fmt.Errorf("decode tool call block %d: %w", index, err)
			}
			activity = mergeToolActivity(activity, []ChatToolActivity{item})
		default:
			return ChatMessage{}, nil, false, fmt.Errorf("message block type %q is unsupported", blockType)
		}
	}
	content := strings.TrimSpace(strings.Join(contentParts, "\n\n"))
	if content == "" && len(blocks) == 0 && status != "streaming" {
		if len(activity) == 0 && !hasNonTextPayload {
			return ChatMessage{}, nil, false, errors.New("message has no visible content")
		}
		return ChatMessage{}, activity, false, nil
	}
	return ChatMessage{
		ID:          id,
		Role:        role,
		Content:     content,
		Status:      status,
		CreatedAtMs: record.Timestamp,
		Blocks:      blocks,
	}, activity, true, nil
}

func decodeActivityTimelineBlock(raw json.RawMessage) ([]ChatToolActivity, error) {
	var timeline struct {
		RunID  string `json:"runId"`
		Groups []struct {
			Items []struct {
				ItemID           string `json:"itemId"`
				ToolID           string `json:"toolId"`
				ToolName         string `json:"toolName"`
				Status           string `json:"status"`
				Label            string `json:"label"`
				Description      string `json:"description"`
				RequiresApproval bool   `json:"requiresApproval"`
				ApprovalState    string `json:"approvalState"`
				StartedAtUnixMS  int64  `json:"startedAtUnixMs"`
				EndedAtUnixMS    int64  `json:"endedAtUnixMs"`
			} `json:"items"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(raw, &timeline); err != nil {
		return nil, err
	}
	out := make([]ChatToolActivity, 0)
	for groupIndex, group := range timeline.Groups {
		for itemIndex, item := range group.Items {
			toolID := strings.TrimSpace(item.ToolID)
			toolName := strings.TrimSpace(item.ToolName)
			if toolID == "" || toolName == "" {
				return nil, fmt.Errorf("activity item %d.%d requires toolId and toolName", groupIndex, itemIndex)
			}
			summary := firstNonEmpty(item.Label, item.Description, toolDisplayName(toolName))
			status, ok := normalizeToolActivityStatus(item.Status)
			if !ok {
				return nil, fmt.Errorf("activity item %d.%d status %q is unsupported", groupIndex, itemIndex, strings.TrimSpace(item.Status))
			}
			out = append(out, ChatToolActivity{
				RunID:            strings.TrimSpace(timeline.RunID),
				ToolID:           toolID,
				ToolName:         toolName,
				Status:           status,
				Summary:          summary,
				RequiresApproval: item.RequiresApproval,
				ApprovalState:    strings.TrimSpace(item.ApprovalState),
				StartedAtMs:      item.StartedAtUnixMS,
				EndedAtMs:        item.EndedAtUnixMS,
			})
		}
	}
	return out, nil
}

func decodeToolCallBlock(raw json.RawMessage) (ChatToolActivity, error) {
	var block struct {
		ToolName         string         `json:"toolName"`
		ToolID           string         `json:"toolId"`
		Args             map[string]any `json:"args"`
		RequiresApproval bool           `json:"requiresApproval"`
		ApprovalState    string         `json:"approvalState"`
		Status           string         `json:"status"`
		Error            string         `json:"error"`
	}
	if err := json.Unmarshal(raw, &block); err != nil {
		return ChatToolActivity{}, err
	}
	toolID := strings.TrimSpace(block.ToolID)
	toolName := strings.TrimSpace(block.ToolName)
	if toolID == "" || toolName == "" {
		return ChatToolActivity{}, errors.New("tool call requires toolId and toolName")
	}
	status, ok := normalizeToolActivityStatus(block.Status)
	if !ok {
		return ChatToolActivity{}, fmt.Errorf("tool call status %q is unsupported", strings.TrimSpace(block.Status))
	}
	errorMessage := strings.TrimSpace(block.Error)
	return ChatToolActivity{
		ToolID:           toolID,
		ToolName:         toolName,
		Status:           status,
		Summary:          summarizeToolActivity(toolName, block.Args, status, errorMessage),
		RequiresApproval: block.RequiresApproval,
		ApprovalState:    strings.TrimSpace(block.ApprovalState),
		ErrorMessage:     errorMessage,
	}, nil
}

func (s *Service) threadToolActivity(ctx context.Context, threadID string) ([]ChatToolActivity, error) {
	records, err := s.ai.ListRecentThreadToolCalls(ctx, s.Meta(), threadID, 80)
	if err != nil {
		return nil, err
	}
	out := make([]ChatToolActivity, 0, len(records))
	for index, record := range records {
		args, err := decodeJSONObject(record.ArgsJSON)
		if err != nil {
			return nil, fmt.Errorf("decode stored tool call %d arguments: %w", index, err)
		}
		status, ok := normalizeToolActivityStatus(record.Status)
		if !ok {
			return nil, fmt.Errorf("stored tool call %d status %q is unsupported", index, strings.TrimSpace(record.Status))
		}
		errorMessage := strings.TrimSpace(record.ErrorMessage)
		if strings.TrimSpace(record.ToolID) == "" || strings.TrimSpace(record.ToolName) == "" {
			return nil, fmt.Errorf("stored tool call %d requires tool_id and tool_name", index)
		}
		out = append(out, ChatToolActivity{
			RunID:        strings.TrimSpace(record.RunID),
			ToolID:       strings.TrimSpace(record.ToolID),
			ToolName:     strings.TrimSpace(record.ToolName),
			Status:       status,
			Summary:      summarizeToolActivity(record.ToolName, args, status, errorMessage),
			ErrorMessage: errorMessage,
			StartedAtMs:  record.StartedAtUnixMs,
			EndedAtMs:    record.EndedAtUnixMs,
		})
	}
	return out, nil
}

func mapChatInputRequest(prompt *ai.RequestUserInputPrompt) (*ChatInputRequest, error) {
	if prompt == nil {
		return nil, nil
	}
	out := &ChatInputRequest{
		PromptID:         strings.TrimSpace(prompt.PromptID),
		MessageID:        strings.TrimSpace(prompt.MessageID),
		ToolID:           strings.TrimSpace(prompt.ToolID),
		ToolName:         strings.TrimSpace(prompt.ToolName),
		ReasonCode:       strings.TrimSpace(prompt.ReasonCode),
		RequiredFromUser: trimStringSlice(prompt.RequiredFromUser),
		EvidenceRefs:     trimStringSlice(prompt.EvidenceRefs),
		PublicSummary:    strings.TrimSpace(prompt.PublicSummary),
		ContainsSecret:   prompt.ContainsSecret,
		Questions:        make([]ChatInputQuestion, 0, len(prompt.Questions)),
	}
	if out.PromptID == "" || out.MessageID == "" || out.ToolID == "" || out.ToolName == "" || len(prompt.Questions) == 0 {
		return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", "Flower waiting input request is incomplete.")
	}
	for index, question := range prompt.Questions {
		mapped := ChatInputQuestion{
			ID:                strings.TrimSpace(question.ID),
			Header:            strings.TrimSpace(question.Header),
			Question:          strings.TrimSpace(question.Question),
			IsSecret:          question.IsSecret,
			ResponseMode:      strings.TrimSpace(question.ResponseMode),
			ChoicesExhaustive: cloneBoolPtr(question.ChoicesExhaustive),
			WriteLabel:        strings.TrimSpace(question.WriteLabel),
			WritePlaceholder:  strings.TrimSpace(question.WritePlaceholder),
			Choices:           make([]ChatInputChoice, 0, len(question.Choices)),
		}
		if !validInputResponseMode(mapped.ResponseMode) {
			return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", fmt.Sprintf("Flower waiting input question %d has an invalid response mode.", index))
		}
		for choiceIndex, choice := range question.Choices {
			nextChoice := ChatInputChoice{
				ChoiceID:         strings.TrimSpace(choice.ChoiceID),
				Label:            strings.TrimSpace(choice.Label),
				Description:      strings.TrimSpace(choice.Description),
				Kind:             strings.TrimSpace(choice.Kind),
				InputPlaceholder: strings.TrimSpace(choice.InputPlaceholder),
				Actions:          make([]ChatInputAction, 0, len(choice.Actions)),
			}
			if nextChoice.ChoiceID == "" || nextChoice.Label == "" || !validInputChoiceKind(nextChoice.Kind) {
				return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", fmt.Sprintf("Flower waiting input choice %d.%d is incomplete.", index, choiceIndex))
			}
			for actionIndex, action := range choice.Actions {
				nextAction := ChatInputAction{
					Type: strings.TrimSpace(action.Type),
					Mode: strings.TrimSpace(action.Mode),
				}
				if nextAction.Type == "" {
					return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", fmt.Sprintf("Flower waiting input action %d.%d.%d is incomplete.", index, choiceIndex, actionIndex))
				}
				nextChoice.Actions = append(nextChoice.Actions, nextAction)
			}
			if len(nextChoice.Actions) == 0 {
				nextChoice.Actions = nil
			}
			mapped.Choices = append(mapped.Choices, nextChoice)
		}
		if len(mapped.Choices) == 0 {
			mapped.Choices = nil
		}
		if mapped.ID == "" || mapped.Header == "" || mapped.Question == "" {
			return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", fmt.Sprintf("Flower waiting input question %d is incomplete.", index))
		}
		if (mapped.ResponseMode == "select" || mapped.ResponseMode == "select_or_write") && len(mapped.Choices) == 0 {
			return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", fmt.Sprintf("Flower waiting input question %d requires choices.", index))
		}
		out.Questions = append(out.Questions, mapped)
	}
	return out, nil
}

func validInputResponseMode(mode string) bool {
	switch strings.TrimSpace(mode) {
	case "select", "write", "select_or_write":
		return true
	default:
		return false
	}
}

func validInputChoiceKind(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "select":
		return true
	default:
		return false
	}
}

func projectInputRequestToolActivity(items []ChatToolActivity, request *ChatInputRequest) ([]ChatToolActivity, error) {
	if request == nil {
		return items, nil
	}
	toolID := strings.TrimSpace(request.ToolID)
	toolName := strings.TrimSpace(request.ToolName)
	if toolID == "" || toolName == "" {
		return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", "Flower waiting input request is missing its tool identity.")
	}
	summary := inputRequestToolSummary(request)
	out := append([]ChatToolActivity(nil), items...)
	for idx, item := range out {
		if strings.TrimSpace(item.ToolID) != toolID || strings.TrimSpace(item.ToolName) != toolName {
			continue
		}
		item.Status = "waiting"
		item.Summary = summary
		item.ErrorMessage = ""
		item.EndedAtMs = 0
		out[idx] = item
		return out, nil
	}
	return nil, newServiceError(http.StatusConflict, "waiting_input_contract_invalid", "Flower waiting input request is missing its matching tool activity.")
}

func inputRequestToolSummary(request *ChatInputRequest) string {
	if request == nil {
		return "Awaiting user input"
	}
	if strings.TrimSpace(request.PublicSummary) != "" {
		return strings.TrimSpace(request.PublicSummary)
	}
	if len(request.Questions) > 0 {
		if strings.TrimSpace(request.Questions[0].Header) != "" {
			return "Awaiting input: " + strings.TrimSpace(request.Questions[0].Header)
		}
		if strings.TrimSpace(request.Questions[0].Question) != "" {
			return "Awaiting input: " + strings.TrimSpace(request.Questions[0].Question)
		}
	}
	return "Awaiting user input"
}

func decodeJSONObject(raw string) (map[string]any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func mergeToolActivity(primary []ChatToolActivity, secondary []ChatToolActivity) []ChatToolActivity {
	out := make([]ChatToolActivity, 0, len(primary)+len(secondary))
	seenExact := map[string]int{}
	findMergeIndex := func(item ChatToolActivity) (int, bool) {
		if idx, ok := seenExact[item.RunID+"\x00"+item.ToolID]; ok {
			return idx, true
		}
		if item.RunID != "" {
			if idx, ok := seenExact["\x00"+item.ToolID]; ok && strings.TrimSpace(out[idx].RunID) == "" {
				return idx, true
			}
			return 0, false
		}
		matched := -1
		for idx, existing := range out {
			if strings.TrimSpace(existing.ToolID) != item.ToolID {
				continue
			}
			if matched >= 0 {
				return 0, false
			}
			matched = idx
		}
		if matched < 0 {
			return 0, false
		}
		return matched, true
	}
	appendOne := func(item ChatToolActivity) {
		item.ToolID = strings.TrimSpace(item.ToolID)
		item.ToolName = strings.TrimSpace(item.ToolName)
		item.RunID = strings.TrimSpace(item.RunID)
		item.Status = strings.TrimSpace(item.Status)
		item.Summary = strings.TrimSpace(item.Summary)
		item.ErrorMessage = strings.TrimSpace(item.ErrorMessage)
		item.ApprovalState = strings.TrimSpace(item.ApprovalState)
		idx, ok := findMergeIndex(item)
		if ok {
			existing := out[idx]
			oldKey := strings.TrimSpace(existing.RunID) + "\x00" + strings.TrimSpace(existing.ToolID)
			if existing.ToolName == "" {
				existing.ToolName = item.ToolName
			}
			if item.Summary != "" && toolActivityStatusRank(item.Status) >= toolActivityStatusRank(existing.Status) {
				existing.Summary = item.Summary
			}
			if toolActivityStatusRank(item.Status) >= toolActivityStatusRank(existing.Status) {
				existing.Status = item.Status
			}
			if existing.ErrorMessage == "" {
				existing.ErrorMessage = item.ErrorMessage
			}
			if existing.RunID == "" {
				existing.RunID = item.RunID
			}
			if existing.StartedAtMs == 0 {
				existing.StartedAtMs = item.StartedAtMs
			}
			if existing.EndedAtMs == 0 {
				existing.EndedAtMs = item.EndedAtMs
			}
			if !existing.RequiresApproval {
				existing.RequiresApproval = item.RequiresApproval
			}
			if existing.ApprovalState == "" {
				existing.ApprovalState = item.ApprovalState
			}
			out[idx] = existing
			delete(seenExact, oldKey)
			seenExact[strings.TrimSpace(existing.RunID)+"\x00"+strings.TrimSpace(existing.ToolID)] = idx
			return
		}
		seenExact[item.RunID+"\x00"+item.ToolID] = len(out)
		out = append(out, item)
	}
	for _, item := range primary {
		appendOne(item)
	}
	for _, item := range secondary {
		appendOne(item)
	}
	return out
}

func toolActivityStatusRank(status string) int {
	switch strings.TrimSpace(status) {
	case "success", "error", "canceled":
		return 3
	case "running", "waiting":
		return 2
	case "pending":
		return 1
	default:
		return 0
	}
}

func withRunID(items []ChatToolActivity, runID string) []ChatToolActivity {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return items
	}
	out := make([]ChatToolActivity, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.RunID) == "" {
			item.RunID = runID
		}
		out = append(out, item)
	}
	return out
}

func summarizeToolActivity(toolName string, args map[string]any, status string, errorMessage string) string {
	name := toolDisplayName(toolName)
	detail := toolActivityDetail(toolName, args)
	if strings.TrimSpace(errorMessage) != "" {
		if detail == "" {
			return name + " failed"
		}
		return name + ": " + detail + " failed"
	}
	if detail == "" {
		return name
	}
	return name + ": " + detail
}

func toolActivityDetail(toolName string, args map[string]any) string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return stringField(args, "command", "cmd")
	case "file.read", "file.edit", "file.write":
		return stringField(args, "path", "file_path", "filePath")
	case "apply_patch":
		return "workspace patch"
	case "write_todos":
		return "todo list"
	case "ask_user":
		return "user input"
	case "exit_plan_mode":
		return "approval request"
	case "task_complete":
		return "final response"
	default:
		return ""
	}
}

func stringField(values map[string]any, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(anyToString(values[key]))
		if value != "" {
			return value
		}
	}
	return ""
}

func toolDisplayName(toolName string) string {
	switch strings.TrimSpace(toolName) {
	case "file.read":
		return "Read file"
	case "file.edit":
		return "Edit file"
	case "file.write":
		return "Write file"
	case "apply_patch":
		return "Apply patch"
	case "terminal.exec":
		return "Run command"
	case "task_complete":
		return "Complete task"
	case "ask_user":
		return "Ask user"
	case "exit_plan_mode":
		return "Request mode switch"
	case "write_todos":
		return "Update todos"
	case "web.search":
		return "Search web"
	default:
		toolName = strings.TrimSpace(toolName)
		if toolName == "" {
			return "Use tool"
		}
		return toolName
	}
}

func normalizeToolActivityStatus(status string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "pending", "queued":
		return "pending", true
	case "running", "recovering":
		return "running", true
	case "waiting", "waiting_user", "waiting_approval":
		return "waiting", true
	case "success", "succeeded", "completed", "complete":
		return "success", true
	case "error", "failed", "failure":
		return "error", true
	case "canceled", "cancelled":
		return "canceled", true
	default:
		return "", false
	}
}

func normalizeChatMessageRole(role string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "user":
		return "user", true
	case "assistant":
		return "assistant", true
	case "system":
		return "system", true
	default:
		return "", false
	}
}

func normalizeChatMessageStatus(status string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "sending":
		return "sending", true
	case "streaming":
		return "streaming", true
	case "error":
		return "error", true
	case "complete", "completed":
		return "complete", true
	default:
		return "", false
	}
}

func chatRunError(view *ai.ThreadView) (*ChatRunError, error) {
	if view == nil {
		return nil, nil
	}
	status, ok := normalizeFlowerRunState(view.RunStatus)
	if !ok {
		return nil, fmt.Errorf("Flower run status %q is unsupported", strings.TrimSpace(view.RunStatus))
	}
	message := strings.TrimSpace(view.RunError)
	if message == "" && status != ai.RunStateFailed && status != ai.RunStateTimedOut {
		return nil, nil
	}
	if message == "" {
		message = "Flower could not finish this reply."
	}
	return &ChatRunError{
		Message: message,
		Code:    strings.TrimSpace(string(status)),
	}, nil
}

func chatRunErrorFromProjection(err error) *ChatRunError {
	if err == nil {
		return nil
	}
	var coded codedServiceError
	if errors.As(err, &coded) {
		return &ChatRunError{
			Code:    coded.ErrorCode(),
			Message: err.Error(),
		}
	}
	return nil
}

func latestMessageCreatedAt(messages []ChatMessage) int64 {
	var latest int64
	for _, message := range messages {
		if message.CreatedAtMs > latest {
			latest = message.CreatedAtMs
		}
	}
	return latest
}

func normalizeFlowerRunState(status string) (ai.RunState, bool) {
	switch ai.RunState(strings.TrimSpace(strings.ToLower(status))) {
	case "", ai.RunStateIdle:
		return ai.RunStateIdle, true
	case ai.RunStateAccepted:
		return ai.RunStateAccepted, true
	case ai.RunStateRunning:
		return ai.RunStateRunning, true
	case ai.RunStateWaitingApproval:
		return ai.RunStateWaitingApproval, true
	case ai.RunStateRecovering:
		return ai.RunStateRecovering, true
	case ai.RunStateFinalizing:
		return ai.RunStateFinalizing, true
	case ai.RunStateWaitingUser:
		return ai.RunStateWaitingUser, true
	case ai.RunStateSuccess:
		return ai.RunStateSuccess, true
	case ai.RunStateFailed:
		return ai.RunStateFailed, true
	case ai.RunStateCanceled:
		return ai.RunStateCanceled, true
	case ai.RunStateTimedOut:
		return ai.RunStateTimedOut, true
	default:
		return "", false
	}
}

func mapRunStatus(status string) (string, error) {
	runState, ok := normalizeFlowerRunState(status)
	if !ok {
		return "", fmt.Errorf("Flower run status %q is unsupported", strings.TrimSpace(status))
	}
	switch runState {
	case ai.RunStateAccepted, ai.RunStateRunning, ai.RunStateRecovering, ai.RunStateFinalizing:
		return "running", nil
	case ai.RunStateWaitingApproval:
		return "waiting_approval", nil
	case ai.RunStateWaitingUser:
		return "waiting_user", nil
	case ai.RunStateFailed, ai.RunStateTimedOut:
		return "failed", nil
	case ai.RunStateSuccess:
		return "success", nil
	default:
		return "idle", nil
	}
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

func flowerHostRunOptions() ai.RunOptions {
	return ai.RunOptions{
		MaxSteps:      24,
		ToolAllowlist: flowerHostToolAllowlist(),
	}
}
