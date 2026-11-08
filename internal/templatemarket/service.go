// Package templatemarket caches passive discovery evidence. It cannot install,
// update, or execute templates; Runtime verifies selected original bytes.
package templatemarket

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	template "github.com/floegence/redeven-service-templates/template"
	"golang.org/x/sync/singleflight"
)

type Item struct {
	template.MarketTemplate
	Classification string `json:"classification"`
	Status         string `json:"status"`
	UpdatedAt      string `json:"updated_at"`
}
type Snapshot struct {
	Items      []Item `json:"items"`
	Generation int64  `json:"generation"`
	Stale      bool   `json:"stale"`
	CheckedAt  int64  `json:"checked_at"`
}
type Service struct {
	Origin string
	Path   string
	Client *http.Client
	mu     sync.Mutex
	flight singleflight.Group
}

func Validate(item Item) error {
	e := template.SourceExpectation{RepositoryID: item.Source.RepositoryID, CommitSHA: item.Source.CommitSHA, SHA256: item.SHA256}
	if e.Validate() != nil || item.TemplateID != template.SourceIdentity(item.Source.RepositoryID, item.DocumentTemplateID) || item.Revision < 1 || item.Source.Ref == "" || !regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`).MatchString(item.Source.Repository) {
		return errors.New("invalid template identity")
	}
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`).MatchString(item.DocumentTemplateID) || !regexp.MustCompile(`^git_[a-f0-9]{48}$`).MatchString(item.ServiceFamilyID) || len(item.Source.Ref) > 256 || strings.ContainsAny(item.Source.Ref, "\\?#\x00\r\n") || strings.Contains(item.Source.Ref, "..") || (item.Deployment != "host" && item.Deployment != "container" && item.Deployment != "compose") {
		return errors.New("invalid template metadata")
	}
	if item.Source.Path != "" {
		for _, part := range strings.Split(item.Source.Path, "/") {
			if part == "" || part == "." || part == ".." {
				return errors.New("invalid source path")
			}
		}
	}
	if len(item.Source.Path) > 1024 || strings.ContainsAny(item.Source.Path, "\\:\x00\r\n") || len(item.Localizations) > 100 {
		return errors.New("invalid source metadata")
	}
	for _, locale := range item.Localizations {
		if strings.TrimSpace(locale.Name) == "" || len(locale.Name) > 800 || strings.TrimSpace(locale.Description) == "" || len(locale.Description) > 40000 {
			return errors.New("invalid localized presentation")
		}
	}
	if (item.Classification != "official" && item.Classification != "community") || (item.Status != "available" && item.Status != "unavailable") {
		return errors.New("invalid template status")
	}
	locale, ok := item.Localizations[item.DefaultLocale]
	if !ok || locale.Name == "" || locale.Description == "" {
		return errors.New("incomplete template presentation")
	}
	if item.Icon != nil && (len(item.Icon.Data) > 65536 || item.Icon.MediaType != "image/svg+xml" || fmt.Sprintf("%x", sha256.Sum256([]byte(item.Icon.Data))) != item.Icon.SHA256) {
		return errors.New("invalid template icon")
	}
	return nil
}
func (s *Service) Cached() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := Snapshot{Items: []Item{}, Stale: true}
	raw, err := os.ReadFile(s.Path)
	if err != nil || len(raw) > 32<<20 {
		return result
	}
	var saved Snapshot
	if json.Unmarshal(raw, &saved) != nil || saved.Generation < 0 || len(saved.Items) > 20000 {
		return result
	}
	seen := map[string]bool{}
	for _, item := range saved.Items {
		if Validate(item) != nil || seen[item.TemplateID] {
			return result
		}
		seen[item.TemplateID] = true
	}
	saved.Stale = true
	return saved
}
func (s *Service) Refresh(ctx context.Context) (Snapshot, error) {
	pending := s.flight.DoChan("refresh", func() (any, error) {
		requestContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		return s.refresh(requestContext)
	})
	select {
	case <-ctx.Done():
		return s.Cached(), ctx.Err()
	case result := <-pending:
		if result.Err != nil {
			return s.Cached(), result.Err
		}
		return result.Val.(Snapshot), nil
	}
}
func (s *Service) refresh(ctx context.Context) (Snapshot, error) {
	origin := s.Origin
	if origin == "" {
		origin = "https://plugins.redeven.com"
	}
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
		return Snapshot{}, errors.New("invalid template market origin")
	}
	client := http.Client{Timeout: 20 * time.Second}
	if s.Client != nil {
		client = *s.Client
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return errors.New("template market redirects are not accepted")
	}
	out := Snapshot{Items: []Item{}, Generation: -1}
	after := ""
	total := 0
	for {
		endpoint := origin + "/v1/service-templates/catalog"
		if after != "" {
			endpoint += "?after=" + url.QueryEscape(after) + "&generation=" + fmt.Sprint(out.Generation)
		}
		req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
		if err != nil {
			return out, err
		}
		res, err := client.Do(req)
		if err != nil {
			return out, err
		}
		raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20+1))
		res.Body.Close()
		total += len(raw)
		if err != nil || res.StatusCode != 200 || len(raw) > 8<<20 || total > 32<<20 {
			return out, errors.New("template market read failed")
		}
		var page struct {
			Data *[]Item `json:"data"`
			Meta *struct {
				Generation *int64          `json:"generation"`
				Stale      *bool           `json:"stale"`
				NextCursor json.RawMessage `json:"next_cursor"`
			} `json:"meta"`
		}
		if json.Unmarshal(raw, &page) != nil || page.Meta == nil || page.Meta.Generation == nil || page.Data == nil || page.Meta.Stale == nil || *page.Meta.Stale || *page.Meta.Generation < 0 || len(*page.Data) > 100 {
			return out, errors.New("invalid template catalog page")
		}
		var nextCursor *string
		if len(page.Meta.NextCursor) == 0 || json.Unmarshal(page.Meta.NextCursor, &nextCursor) != nil {
			return out, errors.New("invalid template cursor")
		}
		if out.Generation < 0 {
			out.Generation = *page.Meta.Generation
		}
		if out.Generation != *page.Meta.Generation {
			return out, errors.New("template generation changed")
		}
		for _, item := range *page.Data {
			if err := Validate(item); err != nil {
				return out, err
			}
			if item.TemplateID <= after {
				return out, errors.New("template catalog ordering changed")
			}
			after = item.TemplateID
			out.Items = append(out.Items, item)
		}
		if len(out.Items) > 20000 {
			return out, errors.New("template catalog limit exceeded")
		}
		if nextCursor == nil {
			break
		}
		if len(*page.Data) == 0 || *nextCursor != after {
			return out, errors.New("invalid template cursor")
		}
	}
	previous := s.Cached()
	if previous.CheckedAt > 0 && out.Generation < previous.Generation {
		return out, errors.New("template generation regressed")
	}
	out.CheckedAt = time.Now().UnixMilli()
	raw, err := json.Marshal(out)
	if err != nil {
		return out, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.Path), 0700); err != nil {
		return out, err
	}
	file, err := os.CreateTemp(filepath.Dir(s.Path), ".templates-*")
	if err != nil {
		return out, err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(raw); err != nil {
		file.Close()
		return out, err
	}
	if err = file.Close(); err != nil {
		return out, err
	}
	if err = os.Rename(file.Name(), s.Path); err != nil {
		return out, err
	}
	return out, nil
}
