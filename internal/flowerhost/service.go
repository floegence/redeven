package flowerhost

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/floegence/floret/observation"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

const hostEndpointID = "flower-host"
const hostLocalFloeAppID = "redeven.flower.host"

type ServiceOptions struct {
	Logger         *slog.Logger
	Paths          Paths
	Identity       HostIdentity
	SecretResolver SecretResolver
	TargetBroker   TargetSessionBroker
	ReadState      *threadreadstate.Store
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
	reads    *threadreadstate.Store
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
	if opts.ReadState == nil {
		return nil, errors.New("missing Flower Host thread read state store")
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
	svc.reads = opts.ReadState
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
	if s == nil {
		return nil
	}
	var err error
	if s.ai != nil {
		err = s.ai.Close()
	}
	if s.reads != nil {
		if closeErr := s.reads.Close(); err == nil {
			err = closeErr
		}
	}
	return err
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
	readRecords, err := s.ensureThreadListReadRecords(ctx, list.Threads)
	if err != nil {
		return ListThreadsResponse{}, err
	}
	for _, view := range list.Threads {
		snapshot, err := s.threadListSnapshot(ctx, &view, readRecords[strings.TrimSpace(view.ThreadID)])
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

func (s *Service) MarkThreadRead(ctx context.Context, threadID string, req ThreadReadRequest) (ThreadSnapshot, error) {
	if s == nil {
		return ThreadSnapshot{}, errors.New("nil Flower Host service")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ThreadSnapshot{}, newServiceError(http.StatusBadRequest, "missing_thread_id", "missing thread id")
	}
	view, err := s.ai.GetThread(ctx, s.Meta(), threadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ThreadSnapshot{}, newServiceError(http.StatusNotFound, "thread_not_found", "thread not found")
	}
	if err != nil {
		return ThreadSnapshot{}, err
	}
	if view == nil {
		return ThreadSnapshot{}, newServiceError(http.StatusNotFound, "thread_not_found", "thread not found")
	}
	requestSnapshot := threadreadstate.FlowerSnapshot{
		ActivityRevision:    req.Snapshot.ActivityRevision,
		LastMessageAtUnixMs: req.Snapshot.LastMessageAtUnixMs,
		ActivitySignature:   strings.TrimSpace(req.Snapshot.ActivitySignature),
		WaitingPromptID:     strings.TrimSpace(req.Snapshot.WaitingPromptID),
	}
	currentThread, err := s.threadSnapshot(ctx, threadID, view)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	currentSnapshot := threadReadSnapshotFromContract(currentThread.ReadStatus.Snapshot)
	requestSnapshot = normalizeFlowerReadSnapshot(requestSnapshot)
	if requestSnapshot.ActivitySignature == "" {
		return ThreadSnapshot{}, newServiceError(http.StatusBadRequest, "missing_read_snapshot_activity_signature", "missing read snapshot activity signature")
	}
	if requestSnapshot.ActivityRevision > currentSnapshot.ActivityRevision || requestSnapshot.LastMessageAtUnixMs > currentSnapshot.LastMessageAtUnixMs {
		return ThreadSnapshot{}, newServiceError(http.StatusBadRequest, "read_snapshot_exceeds_thread", "read snapshot exceeds current thread state")
	}
	if requestSnapshot.ActivityRevision == currentSnapshot.ActivityRevision &&
		(requestSnapshot.ActivitySignature != currentSnapshot.ActivitySignature || requestSnapshot.WaitingPromptID != currentSnapshot.WaitingPromptID) {
		return ThreadSnapshot{}, newServiceError(http.StatusBadRequest, "read_snapshot_mismatched_thread_activity", "read snapshot does not match current thread activity")
	}
	if _, err := s.advanceThreadReadSnapshot(ctx, threadID, requestSnapshot); err != nil {
		return ThreadSnapshot{}, err
	}
	snapshot, err := s.threadSnapshot(ctx, threadID, nil)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	return snapshot, nil
}

func (s *Service) advanceThreadReadSnapshot(ctx context.Context, threadID string, snapshot threadreadstate.FlowerSnapshot) (threadreadstate.Record, error) {
	if s == nil || s.reads == nil {
		return threadreadstate.Record{}, errors.New("missing Flower Host thread read state store")
	}
	return s.reads.AdvanceFlower(ctx, hostEndpointID, threadID, snapshot)
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

func (s *Service) threadListSnapshot(ctx context.Context, view *ai.ThreadView, readRecord threadreadstate.Record) (ThreadSnapshot, error) {
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
	updatedAtMs := maxInt64(view.UpdatedAtUnixMs, view.LastMessageAtUnixMs)
	readSnapshot := flowerReadSnapshotFromView(*view)
	return ThreadSnapshot{
		ThreadID:     strings.TrimSpace(view.ThreadID),
		Title:        firstNonEmpty(view.Title, view.LastMessagePreview, "Untitled conversation"),
		ModelID:      strings.TrimSpace(view.ModelID),
		WorkingDir:   strings.TrimSpace(view.WorkingDir),
		PinnedAtMs:   view.PinnedAtUnixMs,
		CreatedAtMs:  view.CreatedAtUnixMs,
		UpdatedAtMs:  updatedAtMs,
		Status:       status,
		Messages:     []ChatMessage{},
		InputRequest: inputRequest,
		Error:        snapshotError,
		HomeHostID:   homeHostID,
		HomeHostKind: homeHostKind,
		SourceLabel:  sourceLabel,
		TargetLabels: targetLabels,
		ReadStatus:   flowerReadStatus(readSnapshot, readRecord),
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
		activeMessage, activeTimeline, visible, err := decodeRawMessage(json.RawMessage(raw))
		if err != nil {
			return ThreadSnapshot{}, fmt.Errorf("decode active Flower run snapshot: %w", err)
		}
		if visible {
			decoded = decoded.upsertMessage(activeMessage)
		}
		decoded.ActivityTimeline = mergeActivityTimeline(decoded.ActivityTimeline, withRunIDActivityTimeline(activeTimeline, runID))
	} else if err != nil {
		return ThreadSnapshot{}, err
	}
	inputRequest, err := mapChatInputRequest(view.WaitingPrompt)
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
	updatedAtMs := maxInt64(maxInt64(view.UpdatedAtUnixMs, view.LastMessageAtUnixMs), latestMessageCreatedAt(decoded.Messages))
	readSnapshot := flowerReadSnapshotFromView(*view, latestMessageCreatedAt(decoded.Messages))
	readRecord, err := s.ensureThreadReadRecord(ctx, strings.TrimSpace(view.ThreadID), readSnapshot)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	todoSnapshot, err := s.threadTodoSnapshot(ctx, threadID)
	if err != nil {
		return ThreadSnapshot{}, err
	}
	return ThreadSnapshot{
		ThreadID:         view.ThreadID,
		Title:            firstNonEmpty(view.Title, view.LastMessagePreview, "Untitled conversation"),
		ModelID:          view.ModelID,
		WorkingDir:       strings.TrimSpace(view.WorkingDir),
		PinnedAtMs:       view.PinnedAtUnixMs,
		CreatedAtMs:      view.CreatedAtUnixMs,
		UpdatedAtMs:      updatedAtMs,
		Status:           status,
		Messages:         decoded.Messages,
		ActivityTimeline: decoded.ActivityTimeline,
		TodoSnapshot:     todoSnapshot,
		InputRequest:     inputRequest,
		Error:            runError,
		HomeHostID:       homeHostID,
		HomeHostKind:     homeHostKind,
		SourceLabel:      sourceLabel,
		TargetLabels:     targetLabels,
		ReadStatus:       flowerReadStatus(readSnapshot, readRecord),
	}, nil
}

func (s *Service) threadTodoSnapshot(ctx context.Context, threadID string) (*ChatTodoSnapshot, error) {
	if s == nil || s.ai == nil {
		return nil, errors.New("nil Flower Host service")
	}
	view, err := s.ai.GetThreadTodos(ctx, s.Meta(), threadID)
	if err != nil {
		return nil, err
	}
	if view == nil || (view.Version <= 0 && len(view.Todos) == 0) {
		return nil, nil
	}
	out := &ChatTodoSnapshot{
		Version:     view.Version,
		UpdatedAtMs: view.UpdatedAtUnixMs,
		Todos:       make([]ChatTodoItem, 0, len(view.Todos)),
	}
	for _, item := range view.Todos {
		status := strings.TrimSpace(item.Status)
		out.Todos = append(out.Todos, ChatTodoItem{
			ID:      strings.TrimSpace(item.ID),
			Content: strings.TrimSpace(item.Content),
			Status:  status,
			Note:    strings.TrimSpace(item.Note),
		})
		out.Summary.Total++
		switch status {
		case ai.TodoStatusPending:
			out.Summary.Pending++
		case ai.TodoStatusInProgress:
			out.Summary.InProgress++
		case ai.TodoStatusCompleted:
			out.Summary.Completed++
		case ai.TodoStatusCancelled:
			out.Summary.Cancelled++
		}
	}
	return out, nil
}

func (s *Service) ensureThreadListReadRecords(ctx context.Context, views []ai.ThreadView) (map[string]threadreadstate.Record, error) {
	if s == nil || s.reads == nil {
		return nil, errors.New("missing Flower Host thread read state store")
	}
	snapshots := make(map[string]threadreadstate.FlowerSnapshot, len(views))
	for _, view := range views {
		threadID := strings.TrimSpace(view.ThreadID)
		if threadID == "" {
			continue
		}
		snapshots[threadID] = flowerReadSnapshotFromView(view)
	}
	return s.reads.EnsureFlower(ctx, hostEndpointID, snapshots)
}

func (s *Service) ensureThreadReadRecord(ctx context.Context, threadID string, snapshot threadreadstate.FlowerSnapshot) (threadreadstate.Record, error) {
	if s == nil || s.reads == nil {
		return threadreadstate.Record{}, errors.New("missing Flower Host thread read state store")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return threadreadstate.Record{}, errors.New("missing thread_id")
	}
	records, err := s.reads.EnsureFlower(ctx, hostEndpointID, map[string]threadreadstate.FlowerSnapshot{
		threadID: snapshot,
	})
	if err != nil {
		return threadreadstate.Record{}, err
	}
	return records[threadID], nil
}

func flowerReadSnapshotFromView(view ai.ThreadView, visibleMessageAtUnixMs ...int64) threadreadstate.FlowerSnapshot {
	waitingPromptID := ""
	if normalizeActivityStatusToken(view.RunStatus) == "waiting_user" && view.WaitingPrompt != nil {
		waitingPromptID = strings.TrimSpace(view.WaitingPrompt.PromptID)
	}
	lastMessageAtUnixMs := view.LastMessageAtUnixMs
	for _, ts := range visibleMessageAtUnixMs {
		lastMessageAtUnixMs = maxInt64(lastMessageAtUnixMs, ts)
	}
	activityRevision := flowerActivityRevision(view.RunStatus, maxInt64(lastMessageAtUnixMs, view.RunUpdatedAtUnixMs))
	return threadreadstate.FlowerSnapshot{
		ActivityRevision:    activityRevision,
		LastMessageAtUnixMs: lastMessageAtUnixMs,
		ActivitySignature:   flowerActivitySignature(view.RunStatus, view.LastContextRunID, activityRevision, waitingPromptID, view.LastMessagePreview),
		WaitingPromptID:     waitingPromptID,
	}
}

func flowerReadStatus(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) ThreadReadStatus {
	snapshot = normalizeFlowerReadSnapshot(snapshot)
	record = normalizeFlowerReadRecord(record)
	return ThreadReadStatus{
		IsUnread: flowerThreadIsUnread(snapshot, record),
		Snapshot: ThreadActivitySnapshot{
			ActivityRevision:    snapshot.ActivityRevision,
			LastMessageAtUnixMs: snapshot.LastMessageAtUnixMs,
			ActivitySignature:   snapshot.ActivitySignature,
			WaitingPromptID:     snapshot.WaitingPromptID,
		},
		ReadState: ThreadReadState{
			LastSeenActivityRevision:  record.LastSeenActivityRevision,
			LastReadMessageAtUnixMs:   record.LastReadMessageAtUnixMs,
			LastSeenActivitySignature: record.LastSeenActivitySignature,
			LastSeenWaitingPromptID:   record.LastSeenWaitingPromptID,
		},
	}
}

func threadReadSnapshotFromContract(snapshot ThreadActivitySnapshot) threadreadstate.FlowerSnapshot {
	return normalizeFlowerReadSnapshot(threadreadstate.FlowerSnapshot{
		ActivityRevision:    snapshot.ActivityRevision,
		LastMessageAtUnixMs: snapshot.LastMessageAtUnixMs,
		ActivitySignature:   strings.TrimSpace(snapshot.ActivitySignature),
		WaitingPromptID:     strings.TrimSpace(snapshot.WaitingPromptID),
	})
}

func normalizeFlowerReadSnapshot(snapshot threadreadstate.FlowerSnapshot) threadreadstate.FlowerSnapshot {
	if snapshot.ActivityRevision < 0 {
		snapshot.ActivityRevision = 0
	}
	if snapshot.LastMessageAtUnixMs < 0 {
		snapshot.LastMessageAtUnixMs = 0
	}
	if snapshot.ActivityRevision < snapshot.LastMessageAtUnixMs {
		snapshot.ActivityRevision = snapshot.LastMessageAtUnixMs
	}
	snapshot.ActivitySignature = strings.TrimSpace(snapshot.ActivitySignature)
	snapshot.WaitingPromptID = strings.TrimSpace(snapshot.WaitingPromptID)
	return snapshot
}

func normalizeFlowerReadRecord(record threadreadstate.Record) threadreadstate.Record {
	if record.LastSeenActivityRevision < 0 {
		record.LastSeenActivityRevision = 0
	}
	if record.LastReadMessageAtUnixMs < 0 {
		record.LastReadMessageAtUnixMs = 0
	}
	record.LastSeenActivitySignature = strings.TrimSpace(record.LastSeenActivitySignature)
	record.LastSeenWaitingPromptID = strings.TrimSpace(record.LastSeenWaitingPromptID)
	return record
}

func flowerThreadIsUnread(snapshot threadreadstate.FlowerSnapshot, record threadreadstate.Record) bool {
	if snapshot.ActivityRevision > record.LastSeenActivityRevision {
		return true
	}
	if snapshot.LastMessageAtUnixMs > record.LastReadMessageAtUnixMs {
		return true
	}
	if snapshot.ActivitySignature != "" && snapshot.ActivitySignature != record.LastSeenActivitySignature {
		return true
	}
	return snapshot.WaitingPromptID != "" && snapshot.WaitingPromptID != strings.TrimSpace(record.LastSeenWaitingPromptID)
}

func flowerActivitySignature(status string, turnID string, activityRevision int64, waitingPromptID string, lastMessagePreview string) string {
	tokens := make([]string, 0, 4)
	normalizedStatus := normalizeActivityStatusToken(status)
	if normalizedStatus != "" {
		tokens = append(tokens, "status:"+normalizedStatus)
	}
	if turnID = strings.TrimSpace(turnID); turnID != "" {
		tokens = append(tokens, "turn:"+turnID)
	}
	tokens = append(tokens, "activity:"+strconv.FormatInt(maxInt64(0, activityRevision), 10))
	if waitingPromptID = strings.TrimSpace(waitingPromptID); waitingPromptID != "" {
		tokens = append(tokens, "prompt:"+waitingPromptID)
	}
	if messageToken := flowerMessagePreviewToken(lastMessagePreview); messageToken != "" {
		tokens = append(tokens, "message:"+messageToken)
	}
	return strings.Join(tokens, "\u001f")
}

func flowerMessagePreviewToken(preview string) string {
	preview = strings.TrimSpace(preview)
	if preview == "" {
		return ""
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(preview))
	return strconv.FormatUint(h.Sum64(), 36)
}

func flowerActivityRevision(status string, baseUnixMs int64) int64 {
	if baseUnixMs <= 0 {
		return flowerRunStatusRevisionOrdinal(status)
	}
	return baseUnixMs*10 + flowerRunStatusRevisionOrdinal(status)
}

func flowerRunStatusRevisionOrdinal(status string) int64 {
	switch normalizeActivityStatusToken(status) {
	case "", "idle":
		return 0
	case "accepted":
		return 1
	case "running", "recovering", "finalizing":
		return 2
	case "waiting_approval":
		return 3
	case "waiting_user":
		return 4
	case "success", "completed":
		return 5
	case "failed", "timed_out", "canceled", "cancelled":
		return 6
	default:
		return 0
	}
}

func normalizeActivityStatusToken(value string) string {
	value = strings.TrimSpace(value)
	value = camelSplitASCII(value)
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	return strings.ToLower(value)
}

func camelSplitASCII(value string) string {
	if value == "" {
		return ""
	}
	var builder strings.Builder
	for index, r := range value {
		if index > 0 && isLowerAlphaNumeric(rune(value[index-1])) && isUpperAlpha(r) {
			builder.WriteByte('_')
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func isLowerAlphaNumeric(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

func isUpperAlpha(r rune) bool {
	return r >= 'A' && r <= 'Z'
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
	Messages         []ChatMessage
	ActivityTimeline []ChatMessageBlock
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
		Messages:         make([]ChatMessage, 0, len(values)),
		ActivityTimeline: []ChatMessageBlock{},
	}
	for index, value := range values {
		msg, timelines, visible, err := decodeRawMessage(value)
		if err != nil {
			return decodedThreadMessages{}, fmt.Errorf("decode Flower message %d: %w", index, err)
		}
		out.ActivityTimeline = mergeActivityTimeline(out.ActivityTimeline, timelines)
		if visible {
			out.Messages = append(out.Messages, msg)
		}
	}
	return out, nil
}

func decodeRawMessage(value any) (ChatMessage, []ChatMessageBlock, bool, error) {
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
	timelines := make([]ChatMessageBlock, 0)
	hasNonTextPayload := false
	hasRenderableMessageBlock := false
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
				hasRenderableMessageBlock = true
			}
		case "thinking":
			text := strings.TrimSpace(firstNonEmpty(base.Content, base.Text))
			if text != "" {
				blocks = append(blocks, ChatMessageBlock{Type: "thinking", Content: text})
				hasRenderableMessageBlock = true
			}
		case "image", "file":
			hasNonTextPayload = true
			// Valid persisted input blocks that the compact Flower transcript does not render yet.
		case "request_user_input_response":
			text := strings.TrimSpace(firstNonEmpty(base.PublicSummary, base.Content, base.Text))
			if text != "" && !base.ContainsSecret {
				contentParts = append(contentParts, text)
				blocks = append(blocks, ChatMessageBlock{Type: "text", Content: text})
				hasRenderableMessageBlock = true
			} else if base.ContainsSecret {
				hasNonTextPayload = true
			}
		case "activity-timeline":
			timeline, err := decodeActivityTimelineBlock(block)
			if err != nil {
				return ChatMessage{}, nil, false, fmt.Errorf("decode activity timeline block %d: %w", index, err)
			}
			blocks = append(blocks, timeline)
			timelines = mergeActivityTimeline(timelines, []ChatMessageBlock{timeline})
		default:
			return ChatMessage{}, nil, false, fmt.Errorf("message block type %q is unsupported", blockType)
		}
	}
	content := strings.TrimSpace(strings.Join(contentParts, "\n\n"))
	if content == "" && !hasRenderableMessageBlock && status != "streaming" {
		if len(timelines) == 0 && !hasNonTextPayload {
			return ChatMessage{}, nil, false, errors.New("message has no visible content")
		}
		return ChatMessage{}, timelines, false, nil
	}
	return ChatMessage{
		ID:          id,
		Role:        role,
		Content:     content,
		Status:      status,
		CreatedAtMs: record.Timestamp,
		Blocks:      blocks,
	}, timelines, true, nil
}

func decodeActivityTimelineBlock(raw json.RawMessage) (ChatMessageBlock, error) {
	var timeline ai.ActivityTimelineBlock
	if err := json.Unmarshal(raw, &timeline); err != nil {
		return ChatMessageBlock{}, err
	}
	timeline.Type = "activity-timeline"
	if err := observation.ValidateActivityTimeline(timeline.ActivityTimeline); err != nil {
		return ChatMessageBlock{}, err
	}
	summary := timeline.Summary
	return ChatMessageBlock{
		Type:          "activity-timeline",
		SchemaVersion: timeline.SchemaVersion,
		RunID:         strings.TrimSpace(timeline.RunID),
		ThreadID:      strings.TrimSpace(timeline.ThreadID),
		TurnID:        strings.TrimSpace(timeline.TurnID),
		TraceID:       strings.TrimSpace(timeline.TraceID),
		Summary:       &summary,
		Items:         append([]observation.ActivityItem(nil), timeline.Items...),
	}, nil
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

func mergeActivityTimeline(primary []ChatMessageBlock, secondary []ChatMessageBlock) []ChatMessageBlock {
	out := make([]ChatMessageBlock, 0, len(primary)+len(secondary))
	seen := map[string]int{}
	appendOne := func(timeline ChatMessageBlock) {
		timeline.Type = "activity-timeline"
		key := strings.TrimSpace(timeline.RunID) + "\x00" + strings.TrimSpace(timeline.TurnID)
		if key == "\x00" {
			key = fmt.Sprintf("timeline:%d", len(out))
		}
		if idx, ok := seen[key]; ok {
			out[idx] = timeline
			return
		}
		seen[key] = len(out)
		out = append(out, timeline)
	}
	for _, timeline := range primary {
		appendOne(timeline)
	}
	for _, timeline := range secondary {
		appendOne(timeline)
	}
	return out
}

func withRunIDActivityTimeline(items []ChatMessageBlock, runID string) []ChatMessageBlock {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return items
	}
	out := make([]ChatMessageBlock, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.RunID) == "" {
			item.RunID = runID
		}
		out = append(out, item)
	}
	return out
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
	case ai.RunStateCanceled:
		return "canceled", nil
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
