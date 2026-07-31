package portforward

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/portforward/registry"
)

type CreateForwardRequest struct {
	Target             string `json:"target"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	HealthPath         string `json:"health_path"`
	InsecureSkipVerify bool   `json:"insecure_skip_verify"`
}

type UpdateForwardRequest struct {
	Target             *string `json:"target,omitempty"`
	Name               *string `json:"name,omitempty"`
	Description        *string `json:"description,omitempty"`
	HealthPath         *string `json:"health_path,omitempty"`
	InsecureSkipVerify *bool   `json:"insecure_skip_verify,omitempty"`
}

type OpenForwardSessionRequest struct {
	Target string `json:"target"`
}

type SaveForwardSessionRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type ForwardSession struct {
	Forward   registry.Forward `json:"forward"`
	AppPath   string           `json:"app_path"`
	Ephemeral bool             `json:"ephemeral"`
}

var ErrForwardNotFound = registry.ErrForwardNotFound

type Service struct {
	reg *registry.Registry

	ephemeralMu         sync.Mutex
	ephemeralByID       map[string]ephemeralForward
	ephemeralIDByTarget map[string]string
	now                 func() time.Time
	newForwardID        func() string
}

type ephemeralForward struct {
	forward        registry.Forward
	lastAccessedAt time.Time
}

const ephemeralForwardTTL = 2 * time.Hour

func New(reg *registry.Registry) (*Service, error) {
	if reg == nil {
		return nil, errors.New("missing registry")
	}
	return &Service{
		reg:                 reg,
		ephemeralByID:       make(map[string]ephemeralForward),
		ephemeralIDByTarget: make(map[string]string),
		now:                 time.Now,
		newForwardID:        randomForwardID,
	}, nil
}

func (s *Service) Close() error {
	if s == nil || s.reg == nil {
		return nil
	}
	return s.reg.Close()
}

func (s *Service) ListForwards(ctx context.Context) ([]registry.Forward, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("portforward not ready")
	}
	return s.reg.ListForwards(ctx)
}

func (s *Service) GetForward(ctx context.Context, forwardID string) (*registry.Forward, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("portforward not ready")
	}
	id := strings.TrimSpace(forwardID)
	if !IsValidForwardID(id) {
		return nil, errors.New("invalid forward_id")
	}
	s.ephemeralMu.Lock()
	defer s.ephemeralMu.Unlock()
	persisted, err := s.reg.GetForward(ctx, id)
	if err != nil || persisted != nil {
		return persisted, err
	}
	return s.getEphemeralForwardLocked(id), nil
}

func (s *Service) OpenForwardSession(ctx context.Context, req OpenForwardSessionRequest) (*ForwardSession, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("portforward not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	targetURL, appPath, err := normalizeBrowserTarget(req.Target)
	if err != nil {
		return nil, err
	}

	s.ephemeralMu.Lock()
	defer s.ephemeralMu.Unlock()

	forwards, err := s.reg.ListForwards(ctx)
	if err != nil {
		return nil, err
	}
	for _, forward := range forwards {
		if forward.TargetURL != targetURL {
			continue
		}
		if err := s.reg.TouchLastOpened(ctx, forward.ForwardID); err != nil {
			return nil, err
		}
		opened, err := s.reg.GetForward(ctx, forward.ForwardID)
		if err != nil {
			return nil, err
		}
		if opened == nil {
			return nil, ErrForwardNotFound
		}
		return &ForwardSession{Forward: *opened, AppPath: appPath, Ephemeral: false}, nil
	}

	now := s.currentTime()
	s.removeExpiredEphemeralLocked(now)
	if existingID := s.ephemeralIDByTarget[targetURL]; existingID != "" {
		if existing, ok := s.ephemeralByID[existingID]; ok {
			existing.lastAccessedAt = now
			existing.forward.LastOpenedAtUnixMs = now.UnixMilli()
			s.ephemeralByID[existingID] = existing
			return &ForwardSession{Forward: existing.forward, AppPath: appPath, Ephemeral: true}, nil
		}
	}

	forwardID, err := s.allocateForwardIDLocked(ctx)
	if err != nil {
		return nil, err
	}
	forward := registry.Forward{
		ForwardID:          forwardID,
		TargetURL:          targetURL,
		CreatedAtUnixMs:    now.UnixMilli(),
		UpdatedAtUnixMs:    now.UnixMilli(),
		LastOpenedAtUnixMs: now.UnixMilli(),
	}
	s.ephemeralByID[forward.ForwardID] = ephemeralForward{forward: forward, lastAccessedAt: now}
	s.ephemeralIDByTarget[targetURL] = forward.ForwardID
	return &ForwardSession{Forward: forward, AppPath: appPath, Ephemeral: true}, nil
}

func (s *Service) SaveForwardSession(ctx context.Context, forwardID string, req SaveForwardSessionRequest) (*registry.Forward, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("portforward not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if !IsValidForwardID(id) {
		return nil, errors.New("invalid forward_id")
	}
	name, description, err := normalizeMeta(strings.TrimSpace(req.Name), strings.TrimSpace(req.Description))
	if err != nil {
		return nil, err
	}

	s.ephemeralMu.Lock()
	defer s.ephemeralMu.Unlock()
	if persisted, err := s.reg.GetForward(ctx, id); err != nil || persisted != nil {
		return persisted, err
	}
	s.removeExpiredEphemeralLocked(s.currentTime())
	ephemeral, ok := s.ephemeralByID[id]
	if !ok {
		return nil, ErrForwardNotFound
	}
	ephemeral.forward.Name = name
	ephemeral.forward.Description = description
	ephemeral.forward.UpdatedAtUnixMs = s.currentTime().UnixMilli()
	if err := s.reg.CreateForward(ctx, ephemeral.forward); err != nil {
		return nil, err
	}
	delete(s.ephemeralByID, id)
	delete(s.ephemeralIDByTarget, ephemeral.forward.TargetURL)
	return s.reg.GetForward(ctx, id)
}

func (s *Service) CreateForward(ctx context.Context, req CreateForwardRequest) (*registry.Forward, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("portforward not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	targetURL, err := normalizeTargetURL(req.Target)
	if err != nil {
		return nil, err
	}

	name, description, err := normalizeMeta(strings.TrimSpace(req.Name), strings.TrimSpace(req.Description))
	if err != nil {
		return nil, err
	}

	s.ephemeralMu.Lock()
	defer s.ephemeralMu.Unlock()
	id, err := s.allocateForwardIDLocked(ctx)
	if err != nil {
		return nil, err
	}

	f := registry.Forward{
		ForwardID:          id,
		TargetURL:          targetURL,
		Name:               name,
		Description:        description,
		HealthPath:         strings.TrimSpace(req.HealthPath),
		InsecureSkipVerify: req.InsecureSkipVerify,
		CreatedAtUnixMs:    0,
		UpdatedAtUnixMs:    0,
		LastOpenedAtUnixMs: 0,
	}
	if err := s.reg.CreateForward(ctx, f); err != nil {
		return nil, err
	}

	return s.reg.GetForward(ctx, id)
}

func (s *Service) UpdateForward(ctx context.Context, forwardID string, req UpdateForwardRequest) (*registry.Forward, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("portforward not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if !IsValidForwardID(id) {
		return nil, errors.New("invalid forward_id")
	}

	if req.Target == nil && req.Name == nil && req.Description == nil && req.HealthPath == nil && req.InsecureSkipVerify == nil {
		return nil, errors.New("missing fields")
	}

	cur, err := s.reg.GetForward(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur == nil {
		return nil, ErrForwardNotFound
	}

	var targetURL *string
	if req.Target != nil {
		v, err := normalizeTargetURL(strings.TrimSpace(*req.Target))
		if err != nil {
			return nil, err
		}
		targetURL = &v
	}

	var name *string
	var description *string
	if req.Name != nil || req.Description != nil {
		nextName := cur.Name
		nextDesc := cur.Description
		if req.Name != nil {
			nextName = strings.TrimSpace(*req.Name)
		}
		if req.Description != nil {
			nextDesc = strings.TrimSpace(*req.Description)
		}
		n, d, err := normalizeMeta(nextName, nextDesc)
		if err != nil {
			return nil, err
		}
		if req.Name != nil {
			name = &n
		}
		if req.Description != nil {
			description = &d
		}
	}

	var healthPath *string
	if req.HealthPath != nil {
		v := strings.TrimSpace(*req.HealthPath)
		healthPath = &v
	}

	patch := registry.UpdateForwardPatch{
		TargetURL:          targetURL,
		Name:               name,
		Description:        description,
		HealthPath:         healthPath,
		InsecureSkipVerify: req.InsecureSkipVerify,
		UpdatedAtUnixMs:    time.Now().UnixMilli(),
	}
	if err := s.reg.UpdateForward(ctx, id, patch); err != nil {
		return nil, err
	}
	updated, err := s.reg.GetForward(ctx, id)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, ErrForwardNotFound
	}
	return updated, nil
}

func (s *Service) DeleteForward(ctx context.Context, forwardID string) error {
	if s == nil || s.reg == nil {
		return errors.New("portforward not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if !IsValidForwardID(id) {
		return errors.New("invalid forward_id")
	}
	return s.reg.DeleteForward(ctx, id)
}

func (s *Service) TouchLastOpened(ctx context.Context, forwardID string) (*registry.Forward, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("portforward not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(forwardID)
	if !IsValidForwardID(id) {
		return nil, errors.New("invalid forward_id")
	}
	s.ephemeralMu.Lock()
	defer s.ephemeralMu.Unlock()
	persisted, err := s.reg.GetForward(ctx, id)
	if err != nil {
		return nil, err
	}
	if persisted == nil {
		now := s.currentTime()
		s.removeExpiredEphemeralLocked(now)
		ephemeral, ok := s.ephemeralByID[id]
		if !ok {
			return nil, ErrForwardNotFound
		}
		ephemeral.forward.LastOpenedAtUnixMs = now.UnixMilli()
		ephemeral.lastAccessedAt = now
		s.ephemeralByID[id] = ephemeral
		out := ephemeral.forward
		return &out, nil
	}
	if err := s.reg.TouchLastOpened(ctx, id); err != nil {
		return nil, err
	}
	f, err := s.reg.GetForward(ctx, id)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, ErrForwardNotFound
	}
	return f, nil
}

func (s *Service) currentTime() time.Time {
	if s != nil && s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *Service) getEphemeralForwardLocked(forwardID string) *registry.Forward {
	now := s.currentTime()
	s.removeExpiredEphemeralLocked(now)
	ephemeral, ok := s.ephemeralByID[forwardID]
	if !ok {
		return nil
	}
	ephemeral.lastAccessedAt = now
	s.ephemeralByID[forwardID] = ephemeral
	out := ephemeral.forward
	return &out
}

func (s *Service) removeExpiredEphemeralLocked(now time.Time) {
	for id, ephemeral := range s.ephemeralByID {
		if now.Sub(ephemeral.lastAccessedAt) < ephemeralForwardTTL {
			continue
		}
		delete(s.ephemeralByID, id)
		if s.ephemeralIDByTarget[ephemeral.forward.TargetURL] == id {
			delete(s.ephemeralIDByTarget, ephemeral.forward.TargetURL)
		}
	}
}

func (s *Service) allocateForwardIDLocked(ctx context.Context) (string, error) {
	for attempts := 0; attempts < 32; attempts++ {
		id := strings.TrimSpace(s.newForwardID())
		if !IsValidForwardID(id) {
			continue
		}
		if _, exists := s.ephemeralByID[id]; exists {
			continue
		}
		persisted, err := s.reg.GetForward(ctx, id)
		if err != nil {
			return "", err
		}
		if persisted == nil {
			return id, nil
		}
	}
	return "", errors.New("could not allocate a unique forward_id")
}

func ParseTargetURL(targetURL string) (*url.URL, error) {
	normalized, err := normalizeTargetURL(targetURL)
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(normalized)
	if err != nil || u == nil {
		return nil, errors.New("invalid target_url")
	}
	return u, nil
}

func normalizeTargetURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", errors.New("missing target")
	}

	// Accept both:
	// - host[:port] (default scheme=http)
	// - http(s)://host[:port]
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}

	u, err := url.Parse(s)
	if err != nil || u == nil {
		return "", errors.New("invalid target")
	}

	scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
	if scheme != "http" && scheme != "https" {
		return "", errors.New("unsupported target scheme (http/https only)")
	}
	if u.User != nil {
		return "", errors.New("target must not contain userinfo")
	}

	host := strings.TrimSpace(u.Hostname())
	if host == "" {
		return "", errors.New("missing target host")
	}

	portStr := strings.TrimSpace(u.Port())
	if portStr == "" {
		if scheme == "https" {
			portStr = "443"
		} else {
			portStr = "80"
		}
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		return "", errors.New("invalid target port")
	}
	hostPort := net.JoinHostPort(host, strconv.Itoa(port))

	// Keep the target minimal and stable: no base path/query/fragment for now.
	if strings.TrimSpace(u.Path) != "" && strings.TrimSpace(u.Path) != "/" {
		return "", errors.New("target path is not supported (use host:port only)")
	}
	if strings.TrimSpace(u.RawQuery) != "" || strings.TrimSpace(u.Fragment) != "" {
		return "", errors.New("target query/fragment is not supported")
	}

	return fmt.Sprintf("%s://%s", scheme, hostPort), nil
}

func normalizeBrowserTarget(raw string) (string, string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", "", errors.New("missing target")
	}
	portCandidate := s
	portSuffix := ""
	if separator := strings.IndexAny(s, "/?#"); separator >= 0 {
		portCandidate = s[:separator]
		portSuffix = s[separator:]
	}
	if _, err := strconv.Atoi(portCandidate); err == nil {
		s = "localhost:" + portCandidate + portSuffix
	} else if strings.HasPrefix(s, ":") {
		s = "localhost" + s
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u == nil {
		return "", "", errors.New("invalid target")
	}
	if u.User != nil {
		return "", "", errors.New("target must not contain userinfo")
	}

	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	if u.RawQuery != "" {
		path += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		path += "#" + u.EscapedFragment()
	}

	origin := *u
	origin.Path = ""
	origin.RawPath = ""
	origin.RawQuery = ""
	origin.Fragment = ""
	targetURL, err := normalizeTargetURL(origin.String())
	if err != nil {
		return "", "", err
	}
	return targetURL, path, nil
}

func randomForwardID() string {
	// 12 chars base32-ish (lowercase alnum).
	//
	// forward_id must be a DNS-safe label, and the external sandbox host is:
	//   pf-<forward_id>.<region>.<base-sandbox-domain>
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 12)
	for i := 0; i < 12; i++ {
		out = append(out, alphabet[int(b[i])%len(alphabet)])
	}
	return string(out)
}

func normalizeMeta(name string, description string) (string, string, error) {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)

	const maxName = 64
	const maxDesc = 256

	if utf8.RuneCountInString(name) > maxName {
		return "", "", errors.New("name is too long")
	}
	if utf8.RuneCountInString(description) > maxDesc {
		return "", "", errors.New("description is too long")
	}
	return name, description, nil
}
