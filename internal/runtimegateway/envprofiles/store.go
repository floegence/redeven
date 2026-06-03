package envprofiles

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const schemaVersion = 1

var (
	gatewayEnvIDPattern = regexp.MustCompile(`\A[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\z`)

	ErrGatewayEnvIDReserved         = errors.New("gateway_env_id is reserved")
	ErrGatewayEnvIDInvalid          = errors.New("gateway_env_id is invalid")
	ErrURLRequired                  = errors.New("url is required")
	ErrURLMustBeAbsoluteHTTP        = errors.New("url must be an absolute http or https URL")
	ErrURLSchemeUnsupported         = errors.New("url must use http or https")
	ErrURLCredentialsUnsupported    = errors.New("url must not include embedded credentials")
	ErrSSHDestinationRequired       = errors.New("ssh_destination is required")
	ErrSSHPortInvalid               = errors.New("ssh_port must be between 1 and 65535")
	ErrContainerEngineInvalid       = errors.New("container_engine must be docker or podman")
	ErrContainerIDRequired          = errors.New("container_id is required")
	ErrContainerRuntimeRootRequired = errors.New("container_runtime_root is required")
	ErrSSHPasswordAuthUnsupported   = errors.New("ssh password auth is not supported for gateway environment profiles yet")
)

type Store struct {
	mu       sync.Mutex
	filePath string
	state    fileState
	loaded   bool
}

type fileState struct {
	SchemaVersion int                  `json:"schema_version"`
	Profiles      []EnvironmentProfile `json:"profiles"`
}

type EnvironmentProfile struct {
	GatewayEnvID    string                          `json:"gateway_env_id"`
	DisplayName     string                          `json:"display_name"`
	AccessRoute     protocol.EnvProfileAccessRoute  `json:"access_route"`
	ControlOwner    protocol.EnvProfileControlOwner `json:"control_owner"`
	SSHPasswordSet  bool                            `json:"ssh_password_set,omitempty"`
	CreatedAtUnixMS int64                           `json:"created_at_unix_ms"`
	UpdatedAtUnixMS int64                           `json:"updated_at_unix_ms"`
}

func NewStore(filePath string) *Store {
	return &Store{filePath: strings.TrimSpace(filePath)}
}

func (s *Store) List(ctx context.Context) ([]EnvironmentProfile, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state, err := s.ensureState()
	if err != nil {
		return nil, err
	}
	profiles := append([]EnvironmentProfile(nil), state.Profiles...)
	sort.SliceStable(profiles, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(profiles[i].DisplayName))
		right := strings.ToLower(strings.TrimSpace(profiles[j].DisplayName))
		if left == right {
			return profiles[i].GatewayEnvID < profiles[j].GatewayEnvID
		}
		return left < right
	})
	return profiles, nil
}

func (s *Store) Get(ctx context.Context, gatewayEnvID string) (EnvironmentProfile, bool, error) {
	if err := ctx.Err(); err != nil {
		return EnvironmentProfile{}, false, err
	}
	state, err := s.ensureState()
	if err != nil {
		return EnvironmentProfile{}, false, err
	}
	cleanID := strings.TrimSpace(gatewayEnvID)
	for _, profile := range state.Profiles {
		if profile.GatewayEnvID == cleanID {
			return profile, true, nil
		}
	}
	return EnvironmentProfile{}, false, nil
}

func (s *Store) Upsert(ctx context.Context, req protocol.EnvProfileUpsertRequest) (protocol.Environment, error) {
	if err := ctx.Err(); err != nil {
		return protocol.Environment{}, err
	}
	if err := protocol.ValidateEnvProfileUpsertRequest(req); err != nil {
		return protocol.Environment{}, err
	}
	req = protocol.NormalizeEnvProfileUpsertRequest(req)
	profile, err := profileFromRequest(req)
	if err != nil {
		return protocol.Environment{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.ensureStateLocked()
	if err != nil {
		return protocol.Environment{}, err
	}
	now := time.Now().UnixMilli()
	if profile.GatewayEnvID == "" {
		profile.GatewayEnvID, err = s.nextGatewayEnvIDLocked(state)
		if err != nil {
			return protocol.Environment{}, err
		}
	}
	if profile.GatewayEnvID == "env_local" {
		return protocol.Environment{}, ErrGatewayEnvIDReserved
	}
	if !gatewayEnvIDPattern.MatchString(profile.GatewayEnvID) {
		return protocol.Environment{}, ErrGatewayEnvIDInvalid
	}
	profile.CreatedAtUnixMS = now
	profile.UpdatedAtUnixMS = now
	replaced := false
	for i := range state.Profiles {
		if state.Profiles[i].GatewayEnvID != profile.GatewayEnvID {
			continue
		}
		profile.CreatedAtUnixMS = state.Profiles[i].CreatedAtUnixMS
		state.Profiles[i] = profile
		replaced = true
		break
	}
	if !replaced {
		state.Profiles = append(state.Profiles, profile)
	}
	if err := s.saveStateLocked(state); err != nil {
		return protocol.Environment{}, err
	}
	return EnvironmentFromProfile(profile), nil
}

func (s *Store) Delete(ctx context.Context, req protocol.EnvProfileDeleteRequest) (protocol.EnvProfileDeleteResponse, error) {
	if err := ctx.Err(); err != nil {
		return protocol.EnvProfileDeleteResponse{}, err
	}
	if err := protocol.ValidateEnvProfileDeleteRequest(req); err != nil {
		return protocol.EnvProfileDeleteResponse{}, err
	}
	req = protocol.NormalizeEnvProfileDeleteRequest(req)

	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.ensureStateLocked()
	if err != nil {
		return protocol.EnvProfileDeleteResponse{}, err
	}
	next := state.Profiles[:0]
	deleted := false
	for _, profile := range state.Profiles {
		if profile.GatewayEnvID == req.GatewayEnvID {
			deleted = true
			continue
		}
		next = append(next, profile)
	}
	state.Profiles = next
	if deleted {
		if err := s.saveStateLocked(state); err != nil {
			return protocol.EnvProfileDeleteResponse{}, err
		}
	}
	return protocol.EnvProfileDeleteResponse{
		ProtocolVersion: protocol.Version,
		GatewayEnvID:    req.GatewayEnvID,
		Deleted:         deleted,
	}, nil
}

func EnvironmentFromProfile(profile EnvironmentProfile) protocol.Environment {
	accessCapabilities := profileAccessCapabilities(profile)
	controlCapabilities := profileControlCapabilities(profile)
	env := protocol.Environment{
		GatewayEnvID:        strings.TrimSpace(profile.GatewayEnvID),
		DisplayName:         strings.TrimSpace(profile.DisplayName),
		EnvKind:             protocol.EnvironmentKindReachableEnv,
		State:               protocol.EnvironmentStateAvailable,
		AccessCapabilities:  accessCapabilities,
		ControlCapabilities: controlCapabilities,
		Profile: &protocol.EnvironmentProfile{
			Managed:         true,
			AccessRouteKind: profile.AccessRoute.Kind,
		},
		ProfileAccessRoute: profileAccessRouteForCatalog(profile),
		Origin: protocol.EnvironmentOrigin{
			Kind:  profileOriginKind(profile),
			Label: profileOriginLabel(profile),
		},
		LastSeenAtUnixMS: profile.UpdatedAtUnixMS,
	}
	return protocol.NormalizeEnvironments([]protocol.Environment{env})[0]
}

func profileAccessRouteForCatalog(profile EnvironmentProfile) *protocol.EnvProfileAccessRoute {
	switch profile.AccessRoute.Kind {
	case protocol.EnvProfileAccessRouteKindURL:
		return &protocol.EnvProfileAccessRoute{
			Kind:        protocol.EnvProfileAccessRouteKindURL,
			URL:         strings.TrimSpace(profile.AccessRoute.URL),
			OriginLabel: strings.TrimSpace(profile.AccessRoute.OriginLabel),
		}
	case protocol.EnvProfileAccessRouteKindSSHHost:
		return &protocol.EnvProfileAccessRoute{
			Kind:                  protocol.EnvProfileAccessRouteKindSSHHost,
			OriginLabel:           strings.TrimSpace(profile.AccessRoute.OriginLabel),
			SSHDestination:        strings.TrimSpace(profile.AccessRoute.SSHDestination),
			SSHPort:               profile.AccessRoute.SSHPort,
			SSHAuthMode:           normalizeSSHAuthMode(profile.AccessRoute.SSHAuthMode),
			SSHPasswordConfigured: profile.SSHPasswordSet,
			SSHRuntimeRoot:        strings.TrimSpace(profile.AccessRoute.SSHRuntimeRoot),
		}
	case protocol.EnvProfileAccessRouteKindSSHContainer:
		return &protocol.EnvProfileAccessRoute{
			Kind:                  protocol.EnvProfileAccessRouteKindSSHContainer,
			OriginLabel:           strings.TrimSpace(profile.AccessRoute.OriginLabel),
			SSHDestination:        strings.TrimSpace(profile.AccessRoute.SSHDestination),
			SSHPort:               profile.AccessRoute.SSHPort,
			SSHAuthMode:           normalizeSSHAuthMode(profile.AccessRoute.SSHAuthMode),
			SSHPasswordConfigured: profile.SSHPasswordSet,
			SSHRuntimeRoot:        strings.TrimSpace(profile.AccessRoute.SSHRuntimeRoot),
			ContainerEngine:       strings.TrimSpace(profile.AccessRoute.ContainerEngine),
			ContainerID:           strings.TrimSpace(profile.AccessRoute.ContainerID),
			ContainerRuntimeRoot:  strings.TrimSpace(profile.AccessRoute.ContainerRuntimeRoot),
		}
	default:
		return nil
	}
}

func profileAccessCapabilities(profile EnvironmentProfile) []protocol.EnvironmentCapability {
	switch profile.AccessRoute.Kind {
	case protocol.EnvProfileAccessRouteKindURL:
		return []protocol.EnvironmentCapability{protocol.EnvironmentCapabilityOpen}
	default:
		return nil
	}
}

func profileControlCapabilities(profile EnvironmentProfile) []protocol.EnvironmentCapability {
	if profile.ControlOwner != protocol.EnvProfileControlOwnerGateway {
		return nil
	}
	return nil
}

func profileFromRequest(req protocol.EnvProfileUpsertRequest) (EnvironmentProfile, error) {
	route := req.Profile.AccessRoute
	switch route.Kind {
	case protocol.EnvProfileAccessRouteKindURL:
		normalizedURL, err := normalizeProfileURL(route.URL)
		if err != nil {
			return EnvironmentProfile{}, err
		}
		route = protocol.EnvProfileAccessRoute{
			Kind:        protocol.EnvProfileAccessRouteKindURL,
			URL:         normalizedURL,
			OriginLabel: strings.TrimSpace(route.OriginLabel),
		}
	case protocol.EnvProfileAccessRouteKindSSHHost:
		normalizedRoute, err := normalizeSSHHostRoute(route)
		if err != nil {
			return EnvironmentProfile{}, err
		}
		route = normalizedRoute
	case protocol.EnvProfileAccessRouteKindSSHContainer:
		normalizedRoute, err := normalizeSSHContainerRoute(route)
		if err != nil {
			return EnvironmentProfile{}, err
		}
		route = normalizedRoute
	default:
		return EnvironmentProfile{}, protocol.ErrMissingAccessRoute
	}
	controlOwner := req.Profile.ControlOwner
	if route.Kind == protocol.EnvProfileAccessRouteKindURL {
		controlOwner = protocol.EnvProfileControlOwnerNone
	}
	sshPasswordSet, err := sshPasswordSetFromRequest(route)
	if err != nil {
		return EnvironmentProfile{}, err
	}
	return EnvironmentProfile{
		GatewayEnvID:   strings.TrimSpace(req.Profile.GatewayEnvID),
		DisplayName:    strings.TrimSpace(req.Profile.DisplayName),
		AccessRoute:    route,
		ControlOwner:   controlOwner,
		SSHPasswordSet: sshPasswordSet,
	}, nil
}

func sshPasswordSetFromRequest(route protocol.EnvProfileAccessRoute) (bool, error) {
	if route.SSHAuthMode == "password" {
		return false, ErrSSHPasswordAuthUnsupported
	}
	return false, nil
}

func normalizeSSHHostRoute(route protocol.EnvProfileAccessRoute) (protocol.EnvProfileAccessRoute, error) {
	destination := strings.TrimSpace(route.SSHDestination)
	if destination == "" {
		return protocol.EnvProfileAccessRoute{}, ErrSSHDestinationRequired
	}
	if route.SSHPort < 0 || route.SSHPort > 65535 {
		return protocol.EnvProfileAccessRoute{}, ErrSSHPortInvalid
	}
	return protocol.EnvProfileAccessRoute{
		Kind:           protocol.EnvProfileAccessRouteKindSSHHost,
		OriginLabel:    strings.TrimSpace(route.OriginLabel),
		SSHDestination: destination,
		SSHPort:        route.SSHPort,
		SSHAuthMode:    normalizeSSHAuthMode(route.SSHAuthMode),
		SSHRuntimeRoot: normalizeRuntimeRoot(route.SSHRuntimeRoot),
	}, nil
}

func normalizeSSHContainerRoute(route protocol.EnvProfileAccessRoute) (protocol.EnvProfileAccessRoute, error) {
	base, err := normalizeSSHHostRoute(route)
	if err != nil {
		return protocol.EnvProfileAccessRoute{}, err
	}
	engine := strings.ToLower(strings.TrimSpace(route.ContainerEngine))
	switch engine {
	case "docker", "podman":
	default:
		return protocol.EnvProfileAccessRoute{}, ErrContainerEngineInvalid
	}
	containerID := strings.TrimSpace(route.ContainerID)
	if containerID == "" {
		return protocol.EnvProfileAccessRoute{}, ErrContainerIDRequired
	}
	base.Kind = protocol.EnvProfileAccessRouteKindSSHContainer
	base.ContainerEngine = engine
	base.ContainerID = containerID
	base.ContainerRuntimeRoot = normalizeRuntimeRoot(route.ContainerRuntimeRoot)
	if base.ContainerRuntimeRoot == "" {
		return protocol.EnvProfileAccessRoute{}, ErrContainerRuntimeRootRequired
	}
	return base, nil
}

func normalizeRuntimeRoot(raw string) string {
	clean := strings.TrimSpace(raw)
	if clean == "" || clean == "remote_default" {
		return "~/.redeven"
	}
	return clean
}

func normalizeSSHAuthMode(raw string) string {
	switch strings.TrimSpace(raw) {
	case "password":
		return "password"
	default:
		return "key_agent"
	}
}

func normalizeProfileURL(raw string) (string, error) {
	clean := strings.TrimSpace(raw)
	if clean == "" {
		return "", ErrURLRequired
	}
	parsed, err := url.Parse(clean)
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", ErrURLMustBeAbsoluteHTTP
	}
	parsed.Scheme = strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", ErrURLSchemeUnsupported
	}
	if parsed.User != nil {
		return "", ErrURLCredentialsUnsupported
	}
	parsed.Host = strings.ToLower(strings.TrimSpace(parsed.Host))
	parsed.Path = "/"
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func profileOriginLabel(profile EnvironmentProfile) string {
	if label := strings.TrimSpace(profile.AccessRoute.OriginLabel); label != "" {
		return label
	}
	switch profile.AccessRoute.Kind {
	case protocol.EnvProfileAccessRouteKindURL:
		parsed, err := url.Parse(strings.TrimSpace(profile.AccessRoute.URL))
		if err != nil || parsed == nil {
			return "Gateway target"
		}
		return strings.TrimSpace(parsed.Host)
	case protocol.EnvProfileAccessRouteKindSSHHost:
		return profile.AccessRoute.SSHDestination
	case protocol.EnvProfileAccessRouteKindSSHContainer:
		if profile.AccessRoute.ContainerID != "" && profile.AccessRoute.SSHDestination != "" {
			return profile.AccessRoute.SSHDestination + " / " + profile.AccessRoute.ContainerID
		}
		if profile.AccessRoute.ContainerID != "" {
			return profile.AccessRoute.ContainerID
		}
		return profile.AccessRoute.SSHDestination
	default:
		return "Gateway target"
	}
}

func profileOriginKind(profile EnvironmentProfile) protocol.EnvironmentOriginKind {
	switch profile.AccessRoute.Kind {
	case protocol.EnvProfileAccessRouteKindSSHHost:
		return protocol.EnvironmentOriginKindSSHTarget
	case protocol.EnvProfileAccessRouteKindSSHContainer:
		return protocol.EnvironmentOriginKindContainer
	default:
		return protocol.EnvironmentOriginKindNetworkTarget
	}
}

func (s *Store) ensureState() (fileState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ensureStateLocked()
}

func (s *Store) ensureStateLocked() (fileState, error) {
	if s.loaded {
		return s.state, nil
	}
	state, err := s.loadState()
	if err != nil {
		return fileState{}, err
	}
	s.state = state
	s.loaded = true
	return state, nil
}

func (s *Store) loadState() (fileState, error) {
	if strings.TrimSpace(s.filePath) == "" {
		return fileState{SchemaVersion: schemaVersion}, nil
	}
	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return fileState{SchemaVersion: schemaVersion}, nil
		}
		return fileState{}, err
	}
	var state fileState
	if err := json.Unmarshal(raw, &state); err != nil {
		return fileState{}, err
	}
	state.SchemaVersion = schemaVersion
	state.Profiles = normalizeProfiles(state.Profiles)
	return state, nil
}

func normalizeProfiles(profiles []EnvironmentProfile) []EnvironmentProfile {
	out := make([]EnvironmentProfile, 0, len(profiles))
	seen := map[string]struct{}{}
	for _, profile := range profiles {
		normalized, err := normalizeProfile(profile)
		if err != nil {
			continue
		}
		if _, ok := seen[normalized.GatewayEnvID]; ok {
			continue
		}
		seen[normalized.GatewayEnvID] = struct{}{}
		out = append(out, normalized)
	}
	return out
}

func normalizeProfile(profile EnvironmentProfile) (EnvironmentProfile, error) {
	input := protocol.NormalizeEnvProfileUpsertRequest(protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: profile.GatewayEnvID,
			DisplayName:  profile.DisplayName,
			AccessRoute:  profile.AccessRoute,
			ControlOwner: profile.ControlOwner,
		},
	})
	normalized, err := profileFromRequest(input)
	if err != nil {
		return EnvironmentProfile{}, err
	}
	if normalized.GatewayEnvID == "" || normalized.DisplayName == "" {
		return EnvironmentProfile{}, protocol.ErrMissingDisplayName
	}
	if normalized.GatewayEnvID == "env_local" || !gatewayEnvIDPattern.MatchString(normalized.GatewayEnvID) {
		return EnvironmentProfile{}, ErrGatewayEnvIDInvalid
	}
	normalized.CreatedAtUnixMS = profile.CreatedAtUnixMS
	normalized.UpdatedAtUnixMS = profile.UpdatedAtUnixMS
	normalized.SSHPasswordSet = normalized.AccessRoute.SSHAuthMode == "password" && (profile.SSHPasswordSet || normalized.SSHPasswordSet)
	return normalized, nil
}

func (s *Store) saveStateLocked(state fileState) error {
	state.SchemaVersion = schemaVersion
	state.Profiles = normalizeProfiles(state.Profiles)
	s.state = state
	s.loaded = true
	if strings.TrimSpace(s.filePath) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, append(body, '\n'), 0o600)
}

func (s *Store) nextGatewayEnvIDLocked(state fileState) (string, error) {
	seen := make(map[string]struct{}, len(state.Profiles))
	for _, profile := range state.Profiles {
		seen[profile.GatewayEnvID] = struct{}{}
	}
	for attempt := 0; attempt < 12; attempt++ {
		id, err := randomGatewayEnvID()
		if err != nil {
			return "", err
		}
		if _, ok := seen[id]; !ok {
			return id, nil
		}
	}
	return "", fmt.Errorf("could not allocate gateway_env_id")
}

func randomGatewayEnvID() (string, error) {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "envp_" + base64.RawURLEncoding.EncodeToString(raw[:]), nil
}
