package containerresource

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

type ManagedOwnerResolver func(context.Context, containerengine.Engine, containerengine.EndpointID, ResourceKind, string) (*ManagedOwner, error)

type Options struct {
	DatabasePath        string
	Engine              *containerengine.Adapter
	ResolveManagedOwner ManagedOwnerResolver
}

type Service struct {
	engine       *containerengine.Adapter
	store        *store
	resolveOwner ManagedOwnerResolver

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu          sync.Mutex
	locks       map[string]chan struct{}
	operations  map[string]context.CancelFunc
	nextSubID   int
	subscribers map[string]map[int]chan Event
}

func Open(options Options) (*Service, error) {
	if options.Engine == nil {
		return nil, errors.New("container engine adapter is required")
	}
	if err := options.Engine.Validate(); err != nil {
		return nil, err
	}
	store, err := openStore(options.DatabasePath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	service := &Service{
		engine: options.Engine, store: store, resolveOwner: options.ResolveManagedOwner,
		ctx: ctx, cancel: cancel, locks: make(map[string]chan struct{}), operations: make(map[string]context.CancelFunc),
		subscribers: make(map[string]map[int]chan Event),
	}
	if err := service.reconcileInterruptedStartup(); err != nil {
		cancel()
		_ = store.close()
		return nil, err
	}
	return service, nil
}

func (s *Service) reconcileInterruptedStartup() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	operations, err := s.store.activeOperations(ctx)
	if err != nil {
		return err
	}
	reconciliations := make(map[string]json.RawMessage, len(operations))
	for _, operation := range operations {
		reconciliations[operation.OperationID] = s.observeInterruptedOperation(ctx, operation)
	}
	return s.store.interruptActive(context.Background(), reconciliations)
}

func (s *Service) observeInterruptedOperation(ctx context.Context, operation Operation) json.RawMessage {
	result := struct {
		Status        string `json:"status"`
		Outcome       string `json:"outcome"`
		ObservedCount int    `json:"observed_count,omitempty"`
	}{Status: "observed", Outcome: "present"}
	bound, _, err := s.engine.BindEndpoint(ctx, operation.Engine, operation.EndpointID)
	if err == nil {
		switch operation.ResourceKind {
		case ResourceContainer:
			_, err = s.engine.Inspect(bound, containerengine.ContainerInspectRequest{Engine: operation.Engine, EndpointID: operation.EndpointID, ContainerID: operation.ResourceIdentity})
			if errors.Is(err, containerengine.ErrContainerNotFound) {
				err, result.Outcome = nil, "absent"
			}
		case ResourceImage:
			if operation.ResourceIdentity == "prune" {
				var items []containerengine.ImageRecord
				items, err = s.engine.ListImages(bound, operation.Engine)
				result.Outcome, result.ObservedCount = "inventory_snapshot", len(items)
			} else {
				_, err = s.engine.InspectImage(bound, containerengine.ImageInspectRequest{Engine: operation.Engine, EndpointID: operation.EndpointID, Image: operation.ResourceIdentity})
				if errors.Is(err, containerengine.ErrImageNotFound) {
					err, result.Outcome = nil, "absent"
				}
			}
		case ResourceVolume:
			var items []containerengine.VolumeRecord
			items, err = s.engine.ListVolumes(bound, operation.Engine)
			if operation.ResourceIdentity == "prune" {
				result.Outcome, result.ObservedCount = "inventory_snapshot", len(items)
			} else if err == nil {
				result.Outcome = "absent"
				for _, item := range items {
					if item.Name == operation.ResourceIdentity {
						result.Outcome = "present"
						break
					}
				}
			}
		case ResourceComposeProject:
			request := containerengine.ComposeProjectRequest{Engine: operation.Engine, EndpointID: operation.EndpointID, ProjectID: operation.ResourceIdentity}
			if strings.HasPrefix(operation.ResourceIdentity, "compose_saved_") {
				err = s.hydrateSavedComposeRequest(ctx, &request)
				if err == nil {
					_, err = s.engine.InspectComposeProject(bound, request)
				}
			} else {
				var items []containerengine.ComposeProject
				items, err = s.engine.ListComposeProjects(bound, containerengine.ComposeProjectListRequest{Engine: operation.Engine, EndpointID: operation.EndpointID})
				if err == nil {
					result.Outcome = "absent"
					for _, item := range items {
						if item.ProjectID == operation.ResourceIdentity {
							result.Outcome = "present"
							break
						}
					}
				}
			}
		case ResourcePod:
			var items []containerengine.PodRecord
			items, err = s.engine.ListPods(bound, containerengine.PodListRequest{Engine: operation.Engine, EndpointID: operation.EndpointID})
			if err == nil {
				result.Outcome = "absent"
				for _, item := range items {
					if item.PodID == operation.ResourceIdentity || item.Name == operation.ResourceIdentity {
						result.Outcome = "present"
						break
					}
				}
			}
		default:
			err = ErrInvalidRequest
		}
	}
	if err != nil {
		result.Status, result.Outcome, result.ObservedCount = "unavailable", "unknown", 0
	}
	raw, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		return json.RawMessage(`{"status":"unavailable","outcome":"unknown"}`)
	}
	return raw
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.cancel()
	s.mu.Lock()
	for _, cancel := range s.operations {
		cancel()
	}
	for key, subscribers := range s.subscribers {
		for id, ch := range subscribers {
			close(ch)
			delete(subscribers, id)
		}
		delete(s.subscribers, key)
	}
	s.mu.Unlock()
	s.wg.Wait()
	return s.store.close()
}

func (s *Service) Preflight(ctx context.Context, req PreflightRequest) (Preflight, error) {
	decoded, err := s.decodeAndPreflight(ctx, req.Method, req.Request)
	if err != nil {
		return Preflight{}, err
	}
	return decoded.preflight, nil
}

func (s *Service) CreateOperation(ctx context.Context, req CreateOperationRequest) (Operation, error) {
	requestID := strings.TrimSpace(req.RequestID)
	if !validPublicID(requestID) {
		return Operation{}, fmt.Errorf("%w: request_id is invalid", ErrInvalidRequest)
	}
	decoded, err := s.decodeAndPreflight(ctx, req.Method, req.Request)
	if err != nil {
		return Operation{}, err
	}
	if !subtleString(req.RequestHash, decoded.preflight.RequestHash) || !subtleString(req.PlanHash, decoded.preflight.PlanHash) {
		return Operation{}, ErrPreflightStale
	}
	now := time.Now().UnixMilli()
	op := Operation{
		OperationID: newID("container_operation"), RequestID: requestID,
		RequestHash: decoded.preflight.RequestHash, PlanHash: decoded.preflight.PlanHash,
		Method: req.Method, Engine: decoded.preflight.Engine, EndpointID: decoded.preflight.EndpointID,
		ResourceKind: decoded.preflight.ResourceKind, ResourceIdentity: decoded.preflight.ResourceIdentity,
		State: OperationQueued, CreatedAtUnixMs: now, UpdatedAtUnixMs: now,
	}
	op, inserted, err := s.store.insertOrExisting(ctx, op)
	if err != nil {
		return Operation{}, wrapStoreError("create", err)
	}
	if !inserted {
		return op, nil
	}

	executionCtx, cancel := context.WithCancel(s.ctx)
	s.mu.Lock()
	s.operations[op.OperationID] = cancel
	s.mu.Unlock()
	s.wg.Add(1)
	requestCopy := append(json.RawMessage(nil), req.Request...)
	go s.run(executionCtx, op.OperationID, req.Method, requestCopy)
	return op, nil
}

func (s *Service) Operation(ctx context.Context, operationID string) (Operation, error) {
	if !validPublicID(operationID) {
		return Operation{}, ErrOperationNotFound
	}
	return s.store.operation(ctx, strings.TrimSpace(operationID))
}

func (s *Service) Operations(ctx context.Context, limit int) ([]Operation, error) {
	return s.store.operations(ctx, limit)
}

func (s *Service) Events(ctx context.Context, operationID string, afterSequence int64) ([]Event, error) {
	if !validPublicID(operationID) {
		return nil, ErrOperationNotFound
	}
	if _, err := s.Operation(ctx, operationID); err != nil {
		return nil, err
	}
	if afterSequence < 0 {
		afterSequence = 0
	}
	return s.store.eventsAfter(ctx, strings.TrimSpace(operationID), afterSequence)
}

func (s *Service) CancelOperation(ctx context.Context, operationID string) (Operation, error) {
	if !validPublicID(operationID) {
		return Operation{}, ErrOperationNotFound
	}
	op, event, err := s.store.requestCancel(ctx, strings.TrimSpace(operationID))
	if err != nil {
		return Operation{}, err
	}
	s.broadcast(event)
	s.mu.Lock()
	cancel := s.operations[operationID]
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return op, nil
}

func (s *Service) Subscribe(ctx context.Context, operationID string, afterSequence int64) ([]Event, <-chan Event, error) {
	if _, err := s.Operation(ctx, operationID); err != nil {
		return nil, nil, err
	}
	if afterSequence < 0 {
		afterSequence = 0
	}
	baseline, err := s.store.eventsAfter(ctx, operationID, afterSequence)
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan Event, 32)
	s.mu.Lock()
	s.nextSubID++
	id := s.nextSubID
	if s.subscribers[operationID] == nil {
		s.subscribers[operationID] = make(map[int]chan Event)
	}
	s.subscribers[operationID][id] = ch
	s.mu.Unlock()
	go func() {
		<-ctx.Done()
		s.mu.Lock()
		if subscribers := s.subscribers[operationID]; subscribers != nil {
			if existing, ok := subscribers[id]; ok {
				close(existing)
				delete(subscribers, id)
			}
			if len(subscribers) == 0 {
				delete(s.subscribers, operationID)
			}
		}
		s.mu.Unlock()
	}()
	return baseline, ch, nil
}

func (s *Service) run(ctx context.Context, operationID string, method containerengine.Method, raw json.RawMessage) {
	defer s.wg.Done()
	defer func() {
		s.mu.Lock()
		delete(s.operations, operationID)
		s.mu.Unlock()
	}()

	decoded, err := s.decodeAndPreflight(ctx, method, raw)
	if err != nil {
		s.finishFailure(operationID, "preflight_stale", "The reviewed operation is no longer valid.", nil)
		return
	}
	op, err := s.store.operation(ctx, operationID)
	if err != nil || op.State.Terminal() {
		return
	}
	if op.RequestHash != decoded.preflight.RequestHash || op.PlanHash != decoded.preflight.PlanHash {
		s.finishFailure(operationID, "preflight_stale", "The reviewed operation changed before execution.", nil)
		return
	}

	unlock, err := s.acquireLocks(ctx, decoded.lockKeys())
	if err != nil {
		s.finishCanceled(operationID)
		return
	}
	defer unlock()
	select {
	case <-ctx.Done():
		s.finishCanceled(operationID)
		return
	default:
	}
	current, err := s.store.operation(ctx, operationID)
	if err != nil || current.State.Terminal() {
		return
	}
	if _, event, err := s.store.transition(ctx, operationID, OperationRunning, "", "", nil); err != nil {
		return
	} else {
		s.broadcast(event)
	}

	s.reportProgress(operationID, OperationProgress{Phase: "executing"})
	result, err := s.execute(ctx, operationID, decoded)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			s.finishCanceled(operationID)
			return
		}
		code, message := publicOperationError(err)
		s.finishFailure(operationID, code, message, json.RawMessage(`{"status":"required"}`))
		return
	}
	s.reportProgress(operationID, OperationProgress{Phase: "reconciling"})
	reconciliation, err := s.reconcile(ctx, decoded, result)
	if err != nil {
		s.finishFailure(operationID, "reconciliation_required", "The engine result could not be authoritatively reconciled.", json.RawMessage(`{"status":"required"}`))
		return
	}
	_, event, err := s.store.transition(ctx, operationID, OperationSucceeded, "", "", reconciliation)
	if err == nil {
		s.broadcast(event)
	}
}

func (s *Service) reportProgress(operationID string, progress OperationProgress) {
	progress.Phase = sanitizeProgressToken(progress.Phase)
	progress.Unit = sanitizeProgressToken(progress.Unit)
	if progress.Phase == "" || progress.Completed < 0 || progress.Total < 0 || (progress.Total > 0 && progress.Completed > progress.Total) {
		return
	}
	payload, err := json.Marshal(progress)
	if err != nil {
		return
	}
	event, err := s.store.appendEvent(context.Background(), operationID, "progress", payload)
	if err == nil {
		s.broadcast(event)
	}
}

func sanitizeProgressToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) > 32 {
		return ""
	}
	for _, r := range value {
		if (r < 'a' || r > 'z') && r != '_' {
			return ""
		}
	}
	return value
}

func (s *Service) finishFailure(operationID, code, message string, reconciliation json.RawMessage) {
	_, event, err := s.store.transition(context.Background(), operationID, OperationFailed, code, message, reconciliation)
	if err == nil {
		s.broadcast(event)
	}
}

func (s *Service) finishCanceled(operationID string) {
	_, event, err := s.store.transition(context.Background(), operationID, OperationCanceled, "canceled", "The operation was canceled.", nil)
	if err == nil {
		s.broadcast(event)
	}
}

func (s *Service) broadcast(event Event) {
	if event.Sequence == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ch := range s.subscribers[event.OperationID] {
		select {
		case ch <- event:
		default:
		}
	}
}

func (s *Service) acquireLocks(ctx context.Context, keys []string) (func(), error) {
	sort.Strings(keys)
	locks := make([]chan struct{}, 0, len(keys))
	s.mu.Lock()
	for _, key := range keys {
		lock := s.locks[key]
		if lock == nil {
			lock = make(chan struct{}, 1)
			lock <- struct{}{}
			s.locks[key] = lock
		}
		locks = append(locks, lock)
	}
	s.mu.Unlock()
	acquired := 0
	for index, lock := range locks {
		select {
		case <-ctx.Done():
			for releaseIndex := acquired - 1; releaseIndex >= 0; releaseIndex-- {
				locks[releaseIndex] <- struct{}{}
			}
			return nil, ctx.Err()
		case <-lock:
			acquired = index + 1
		}
	}
	return func() {
		for index := len(locks) - 1; index >= 0; index-- {
			locks[index] <- struct{}{}
		}
	}, nil
}

type decodedMutation struct {
	request        any
	canonical      json.RawMessage
	preflight      Preflight
	lockIdentities []string
}

func (d decodedMutation) lockKeys() []string {
	identities := d.lockIdentities
	if len(identities) == 0 {
		identities = []string{d.preflight.ResourceIdentity}
	}
	keys := make([]string, 0, len(identities))
	for _, identity := range identities {
		keys = append(keys, strings.Join([]string{string(d.preflight.Engine), string(d.preflight.EndpointID), string(d.preflight.ResourceKind), strings.TrimSpace(identity)}, "\x00"))
	}
	return keys
}

func (s *Service) decodeAndPreflight(ctx context.Context, method containerengine.Method, raw json.RawMessage) (decodedMutation, error) {
	request, err := decodeMutationRequest(method, raw)
	if err != nil {
		return decodedMutation{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	canonical, err := json.Marshal(request)
	if err != nil {
		return decodedMutation{}, fmt.Errorf("%w: encode request", ErrInvalidRequest)
	}
	if composeRequest, ok := request.(*containerengine.ComposeProjectRequest); ok {
		if err := s.hydrateSavedComposeRequest(ctx, composeRequest); err != nil {
			return decodedMutation{}, err
		}
	}
	engine, endpointID, kind, identity, identities := mutationIdentity(method, request)
	bound, _, err := s.engine.BindEndpoint(ctx, engine, endpointID)
	if err != nil {
		return decodedMutation{}, err
	}
	plan, err := s.buildPlan(bound, method, request)
	if err != nil {
		return decodedMutation{}, err
	}
	// The reviewed digest still covers the canonical request, but raw mutation
	// inputs (environment values, command arguments, and driver options) never
	// cross the native API or enter the operation database.
	plan.Request = nil
	requestHash := hashJSON(struct {
		Method  containerengine.Method `json:"method"`
		Request json.RawMessage        `json:"request"`
	}{Method: method, Request: canonical})
	management, err := s.management(ctx, engine, endpointID, kind, identity, identities)
	if err != nil {
		return decodedMutation{}, err
	}
	if management.Managed {
		return decodedMutation{}, &ManagedResourceError{Owner: *management.Owner}
	}
	return decodedMutation{
		request: request, canonical: canonical, lockIdentities: identities,
		preflight: Preflight{
			Method: method, Engine: engine, EndpointID: endpointID, ResourceKind: kind, ResourceIdentity: identity,
			RequestHash: requestHash, PlanHash: plan.PlanDigest, Plan: plan, Management: management,
		},
	}, nil
}

func (s *Service) management(ctx context.Context, engine containerengine.Engine, endpointID containerengine.EndpointID, kind ResourceKind, identity string, identities []string) (Management, error) {
	if s.resolveOwner == nil || kind == ResourceImage || kind == ResourcePod {
		return Management{}, nil
	}
	if len(identities) == 0 {
		identities = []string{identity}
	}
	for _, item := range identities {
		owner, err := s.resolveOwner(ctx, engine, endpointID, kind, item)
		if err != nil {
			return Management{}, fmt.Errorf("resolve managed container resource: %w", err)
		}
		if owner != nil {
			return Management{Managed: true, Owner: owner}, nil
		}
	}
	return Management{}, nil
}

func decodeMutationRequest(method containerengine.Method, raw json.RawMessage) (any, error) {
	if len(raw) == 0 || len(raw) > 1<<20 {
		return nil, errors.New("request payload is empty or too large")
	}
	var target any
	switch method {
	case containerengine.MethodContainersCreate:
		target = &containerengine.ContainerCreateRequest{}
	case containerengine.MethodStart, containerengine.MethodStop, containerengine.MethodRestart,
		containerengine.MethodRemove, containerengine.MethodPause, containerengine.MethodUnpause, containerengine.MethodKill:
		target = &containerengine.ContainerActionRequest{}
	case containerengine.MethodImagesPull:
		target = &containerengine.ImagePullRequest{}
	case containerengine.MethodImagesTag:
		target = &containerengine.ImageTagRequest{}
	case containerengine.MethodImagesRemove:
		target = &containerengine.ImageRemovePreflightRequest{}
	case containerengine.MethodImagesPrune, containerengine.MethodVolumesPrune:
		target = &containerengine.ResourcePruneRequest{}
	case containerengine.MethodVolumesCreate:
		target = &containerengine.VolumeCreateRequest{}
	case containerengine.MethodVolumesRemove:
		target = &containerengine.VolumeRemovePreflightRequest{}
	case containerengine.MethodComposeProjectsStart, containerengine.MethodComposeProjectsStop,
		containerengine.MethodComposeProjectsRestart, containerengine.MethodComposeProjectsDown:
		target = &containerengine.ComposeProjectRequest{}
	case containerengine.MethodPodsCreate:
		target = &containerengine.PodCreateRequest{}
	case containerengine.MethodPodsStart, containerengine.MethodPodsStop, containerengine.MethodPodsRestart, containerengine.MethodPodsRemove:
		target = &containerengine.PodRequest{}
	default:
		return nil, fmt.Errorf("unsupported mutation method %q", method)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("request must contain one JSON object")
	}
	return target, nil
}

func mutationIdentity(method containerengine.Method, request any) (containerengine.Engine, containerengine.EndpointID, ResourceKind, string, []string) {
	switch req := request.(type) {
	case *containerengine.ContainerCreateRequest:
		identity := strings.TrimSpace(req.Name)
		if identity == "" {
			identity = strings.TrimSpace(req.Image)
		}
		return req.Engine, req.EndpointID, ResourceContainer, identity, nil
	case *containerengine.ContainerActionRequest:
		return req.Engine, req.EndpointID, ResourceContainer, strings.TrimSpace(req.ContainerID), nil
	case *containerengine.ImagePullRequest:
		return req.Engine, req.EndpointID, ResourceImage, strings.TrimSpace(req.ImageRef), nil
	case *containerengine.ImageTagRequest:
		return req.Engine, req.EndpointID, ResourceImage, strings.TrimSpace(req.Image), []string{req.Image, req.Tag}
	case *containerengine.ImageRemovePreflightRequest:
		return req.Engine, req.EndpointID, ResourceImage, strings.TrimSpace(req.Image), nil
	case *containerengine.ResourcePruneRequest:
		kind := ResourceImage
		if method == containerengine.MethodVolumesPrune {
			kind = ResourceVolume
		}
		return req.Engine, req.EndpointID, kind, "prune", append([]string(nil), req.ResourceIdentities...)
	case *containerengine.VolumeCreateRequest:
		return req.Engine, req.EndpointID, ResourceVolume, strings.TrimSpace(req.Name), nil
	case *containerengine.VolumeRemovePreflightRequest:
		return req.Engine, req.EndpointID, ResourceVolume, strings.TrimSpace(req.Name), nil
	case *containerengine.ComposeProjectRequest:
		return req.Engine, req.EndpointID, ResourceComposeProject, strings.TrimSpace(req.ProjectID), nil
	case *containerengine.PodCreateRequest:
		return req.Engine, req.EndpointID, ResourcePod, strings.TrimSpace(req.Name), nil
	case *containerengine.PodRequest:
		return req.Engine, req.EndpointID, ResourcePod, strings.TrimSpace(req.PodID), nil
	default:
		return "", "", "", "", nil
	}
}

func (s *Service) buildPlan(ctx context.Context, method containerengine.Method, request any) (containerengine.ResourcePlan, error) {
	switch req := request.(type) {
	case *containerengine.ContainerCreateRequest:
		return s.engine.CreatePreflight(*req)
	case *containerengine.ContainerActionRequest:
		return s.engine.ContainerActionPreflight(ctx, method, *req)
	case *containerengine.ImagePullRequest:
		return s.engine.PullImagePreflight(*req)
	case *containerengine.ImageTagRequest:
		return s.engine.TagImagePreflight(*req)
	case *containerengine.ImageRemovePreflightRequest:
		return s.engine.RemoveImagePreflight(ctx, *req)
	case *containerengine.ResourcePruneRequest:
		if method == containerengine.MethodImagesPrune {
			return s.engine.PruneImagesPreflight(ctx, *req)
		}
		return s.engine.PruneVolumesPreflight(ctx, *req)
	case *containerengine.VolumeCreateRequest:
		return s.engine.CreateVolumePreflight(*req)
	case *containerengine.VolumeRemovePreflightRequest:
		return s.engine.RemoveVolumePreflight(ctx, *req)
	case *containerengine.ComposeProjectRequest:
		return s.engine.ComposeProjectPreflight(ctx, method, *req)
	case *containerengine.PodCreateRequest:
		return s.engine.CreatePodPreflight(ctx, *req)
	case *containerengine.PodRequest:
		return s.engine.PodActionPreflight(ctx, method, *req)
	default:
		return containerengine.ResourcePlan{}, ErrInvalidRequest
	}
}

func hashJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func subtleString(left, right string) bool {
	leftSum := sha256.Sum256([]byte(strings.TrimSpace(left)))
	rightSum := sha256.Sum256([]byte(strings.TrimSpace(right)))
	return leftSum == rightSum && strings.TrimSpace(left) == strings.TrimSpace(right)
}

func validPublicID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 8 || len(value) > 160 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' || r == ':' {
			continue
		}
		return false
	}
	return true
}

func newID(prefix string) string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(value[:])
}

func publicOperationError(err error) (string, string) {
	switch {
	case errors.Is(err, context.Canceled):
		return "canceled", "The operation was canceled."
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, containerengine.ErrEngineTimeout):
		return "engine_timeout", "The container engine did not finish the operation in time."
	case errors.Is(err, containerengine.ErrPermissionDenied):
		return "engine_permission_denied", "The container engine denied this operation."
	case errors.Is(err, containerengine.ErrBackendUnreachable), errors.Is(err, containerengine.ErrDaemonStopped):
		return "engine_unavailable", "The selected container engine endpoint is unavailable."
	case errors.Is(err, containerengine.ErrInsufficientStorage):
		return "insufficient_storage", "The container engine does not have enough storage to pull this image."
	case errors.Is(err, containerengine.ErrImageRateLimited):
		return "registry_rate_limited", "The image registry rate limit was reached. Try again later or sign in to the registry."
	case errors.Is(err, containerengine.ErrImageNotFound):
		return "image_not_found", "The image or requested platform was not found in the registry."
	case errors.Is(err, containerengine.ErrImageAccessDenied):
		return "registry_access_denied", "The image registry denied access. Check the image name and registry sign-in."
	case errors.Is(err, containerengine.ErrImageRegistryUnavailable):
		return "registry_unavailable", "The image registry could not be reached. Check the network and try again."
	case errors.Is(err, containerengine.ErrResourcePlanStale):
		return "preflight_stale", "The reviewed resource state changed before the operation completed."
	default:
		return "operation_failed", "The container engine could not complete this operation."
	}
}
