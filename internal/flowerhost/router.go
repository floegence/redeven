package flowerhost

import (
	"errors"
	"strings"
	"sync"
)

type Router struct {
	mu        sync.Mutex
	revision  int64
	identity  HostIdentity
	decisions map[string]RouterDecision
	health    HostRuntimeHealth
}

type HostRuntimeHealth struct {
	Configured bool
	ReasonCode string
	Message    string
}

func NewRouter(identity HostIdentity) *Router {
	return &Router{
		identity:  normalizeIdentity(identity),
		decisions: make(map[string]RouterDecision),
		health: HostRuntimeHealth{
			Configured: true,
		},
	}
}

func (r *Router) UpdateHealth(health HostRuntimeHealth) {
	if r == nil {
		return
	}
	health.ReasonCode = strings.TrimSpace(health.ReasonCode)
	health.Message = strings.TrimSpace(health.Message)
	if health.Configured && health.ReasonCode == "" {
		health.ReasonCode = ReasonHostAvailable
	}
	if !health.Configured && health.ReasonCode == "" {
		health.ReasonCode = ReasonHostNotConfigured
	}
	if !health.Configured && health.Message == "" {
		health.Message = "Configure a Flower model provider before starting a conversation."
	}
	r.mu.Lock()
	r.health = health
	r.mu.Unlock()
}

func (r *Router) Resolve(req ResolveRequest) (RouterDecision, error) {
	return r.resolve(req, "")
}

func (r *Router) Switch(req HandlerSwitchRequest) (RouterDecision, error) {
	if strings.TrimSpace(req.RequestedHandlerID) == "" {
		return RouterDecision{}, errors.New("missing requested_handler_id")
	}
	return r.resolve(ResolveRequest{
		ThreadKind:         req.DecisionScope.ThreadKind,
		ContextEnvelopeID:  req.DecisionScope.ContextEnvelopeID,
		ClientSurface:      req.DecisionScope.ClientSurface,
		PrimaryTargetID:    req.DecisionScope.PrimaryTargetID,
		RequestedHandlerID: req.RequestedHandlerID,
	}, SelectionSourceUserSelected)
}

func (r *Router) Latest(decisionID string) (RouterDecision, bool) {
	if r == nil {
		return RouterDecision{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	decision, ok := r.decisions[strings.TrimSpace(decisionID)]
	return decision, ok
}

func (r *Router) Presence() HostPresence {
	identity := normalizeIdentity(r.identity)
	r.mu.Lock()
	health := r.health
	r.mu.Unlock()
	state := HandlerStateOnline
	if !health.Configured {
		state = HandlerStateUnreachable
	}
	return HostPresence{
		SchemaVersion: SchemaVersion,
		HostID:        identity.HostID,
		HostKind:      identity.HostKind,
		CarrierKind:   identity.CarrierKind,
		DisplayName:   "Flower Host",
		State:         state,
		Endpoint: PresenceEndpoint{
			Visibility: "loopback",
		},
		Capabilities:     []string{"flower_threads", "model_runtime", "settings", "router_decision"},
		LastSeenAtUnixMs: unixMs(),
	}
}

func (r *Router) resolve(req ResolveRequest, forcedSelectionSource string) (RouterDecision, error) {
	if r == nil {
		return RouterDecision{}, errors.New("nil router")
	}
	r.mu.Lock()
	health := r.health
	r.mu.Unlock()
	scope := normalizeDecisionScope(req)
	selectionSource := forcedSelectionSource
	if selectionSource == "" {
		selectionSource = SelectionSourceRouterDefault
	}
	global := HandlerRef{
		HandlerID:           r.identity.HostID,
		HandlerKind:         HandlerKindGlobal,
		DisplayName:         "Flower Host",
		CarrierKind:         r.identity.CarrierKind,
		State:               HandlerStateOnline,
		SelectionSource:     selectionSource,
		SupportsThreadKinds: []string{ThreadKindChat, ThreadKindTask},
		AllowedTargetIDs:    []string{},
	}
	if !health.Configured {
		global.State = HandlerStateUnreachable
	}
	if scope.PrimaryTargetID != nil && strings.TrimSpace(*scope.PrimaryTargetID) != "" {
		global.AllowedTargetIDs = []string{strings.TrimSpace(*scope.PrimaryTargetID)}
	}

	requestedHandlerID := strings.TrimSpace(req.RequestedHandlerID)
	var selected *HandlerRef
	var route string
	var reason string
	var blocker *DecisionBlocker
	available := []HandlerRef{}
	unavailable := []UnavailableHandler{}
	allowedActions := []string{"start_thread", "continue_thread"}

	if !health.Configured {
		route = RouteBlocked
		reason = health.ReasonCode
		blocker = &DecisionBlocker{
			Code:    health.ReasonCode,
			Message: health.Message,
		}
		unavailable = append(unavailable, UnavailableHandler{
			HandlerID:      global.HandlerID,
			HandlerKind:    global.HandlerKind,
			DisplayName:    global.DisplayName,
			CarrierKind:    global.CarrierKind,
			State:          HandlerStateUnreachable,
			DisabledReason: health.ReasonCode,
		})
		allowedActions = []string{}
	} else {
		available = append(available, global)
	}

	if health.Configured && (requestedHandlerID == "" || requestedHandlerID == global.HandlerID) {
		selected = &available[0]
		route = RouteFlowerHost
		reason = ReasonHostAvailable
	} else if health.Configured {
		route = RouteBlocked
		reason = ReasonRequestedHandlerInvalid
		blocker = &DecisionBlocker{
			Code:    ReasonRequestedHandlerInvalid,
			Message: "That Flower handler is not available for this context.",
		}
		unavailable = append(unavailable, UnavailableHandler{
			HandlerID:      requestedHandlerID,
			HandlerKind:    HandlerKindGlobal,
			DisplayName:    requestedHandlerID,
			State:          HandlerStateUnreachable,
			DisabledReason: ReasonRequestedHandlerInvalid,
		})
		allowedActions = []string{}
	}

	decisionID, err := newDecisionID()
	if err != nil {
		return RouterDecision{}, err
	}
	r.mu.Lock()
	r.revision++
	revision := r.revision
	r.mu.Unlock()

	uiChips := []UIChip{{Kind: "host", Label: "Using Flower Host", Tone: "normal"}}
	if !health.Configured {
		uiChips = []UIChip{{Kind: "host", Label: "Flower needs setup", Tone: "warning"}}
	}
	if scope.PrimaryTargetID != nil && strings.TrimSpace(*scope.PrimaryTargetID) != "" {
		uiChips = append(uiChips, UIChip{Kind: "source", Label: "Environment context ready", Tone: "normal"})
	}
	decision := RouterDecision{
		DecisionID:          decisionID,
		DecisionRevision:    revision,
		Route:               route,
		ReasonCode:          reason,
		SelectedHandler:     selected,
		AvailableHandlers:   available,
		UnavailableHandlers: unavailable,
		HandlerSelection: HandlerSelection{
			CanSwitch:                       false,
			RequiresUserVisibleConfirmation: true,
		},
		DecisionScope:   scope,
		HostPresence:    r.Presence(),
		AllowedActions:  allowedActions,
		UIChips:         uiChips,
		Blocker:         blocker,
		CreatedAtUnixMs: unixMs(),
	}
	r.mu.Lock()
	r.decisions[decision.DecisionID] = decision
	r.mu.Unlock()
	return decision, nil
}

func normalizeDecisionScope(req ResolveRequest) DecisionScope {
	threadKind := strings.TrimSpace(req.ThreadKind)
	if threadKind == "" {
		threadKind = ThreadKindChat
	}
	clientSurface := strings.TrimSpace(req.ClientSurface)
	if clientSurface == "" {
		clientSurface = ClientSurfaceFlowerSurface
	}
	return DecisionScope{
		ThreadKind:        threadKind,
		ContextEnvelopeID: cleanOptionalString(req.ContextEnvelopeID),
		ClientSurface:     clientSurface,
		PrimaryTargetID:   cleanOptionalString(req.PrimaryTargetID),
	}
}

func cleanOptionalString(in *string) *string {
	if in == nil {
		return nil
	}
	value := strings.TrimSpace(*in)
	if value == "" {
		return nil
	}
	return &value
}

func sameDecisionScope(left DecisionScope, right DecisionScope) bool {
	if strings.TrimSpace(left.ThreadKind) != strings.TrimSpace(right.ThreadKind) {
		return false
	}
	if strings.TrimSpace(left.ClientSurface) != strings.TrimSpace(right.ClientSurface) {
		return false
	}
	return optionalStringEqual(left.ContextEnvelopeID, right.ContextEnvelopeID) &&
		optionalStringEqual(left.PrimaryTargetID, right.PrimaryTargetID)
}

func optionalStringEqual(left *string, right *string) bool {
	return strings.TrimSpace(valueOrEmpty(left)) == strings.TrimSpace(valueOrEmpty(right))
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
