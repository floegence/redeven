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
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven-agent/internal/portforward/registry"
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

type Service struct {
	reg *registry.Registry
}

func New(reg *registry.Registry) (*Service, error) {
	if reg == nil {
		return nil, errors.New("missing registry")
	}
	return &Service{reg: reg}, nil
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

	id := randomForwardID()

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
		cur, err := s.reg.GetForward(ctx, id)
		if err != nil {
			return nil, err
		}
		if cur == nil {
			return nil, errors.New("port forward not found")
		}
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
	return s.reg.GetForward(ctx, id)
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
	if err := s.reg.TouchLastOpened(ctx, id); err != nil {
		return nil, err
	}
	return s.reg.GetForward(ctx, id)
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
