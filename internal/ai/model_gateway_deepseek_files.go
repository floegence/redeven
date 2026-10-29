package ai

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
)

// A product owner scopes upstream upload caches to configured provider identity.
// It stores no attachment bytes, canonical history, or upload lifecycle.
type deepSeekImageFileOwners struct {
	mu          sync.Mutex
	owners      map[string]deepSeekImageFileOwner
	identityKey []byte
}
type deepSeekImageFileOwner struct {
	scope string
	files *flprovider.DeepSeekImageFiles
}

func officialDeepSeekEndpoint(base string) bool {
	if strings.TrimSpace(base) == "" {
		return true
	}
	u, err := url.Parse(base)
	return err == nil && u.Scheme == "https" && u.Host == "api.deepseek.com" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (strings.TrimRight(u.Path, "/") == "" || strings.TrimRight(u.Path, "/") == "/v1")
}
func (o *deepSeekImageFileOwners) configure(adapter ModelGateway, providerID string) error {
	p, ok := adapter.(*deepSeekProvider)
	if !ok || !officialDeepSeekEndpoint(p.baseURL) {
		return nil
	}
	baseURL := p.baseURL
	if baseURL == "" {
		baseURL = "https://api.deepseek.com"
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	// A random owner-local key prevents a leaked cache identity from becoming
	// an offline credential oracle or a fingerprint shared across runtimes.
	if o.identityKey == nil {
		o.identityKey = make([]byte, 32)
		if _, err := rand.Read(o.identityKey); err != nil {
			o.identityKey = nil
			return err
		}
	}
	identity := hmac.New(sha256.New, o.identityKey)
	_, _ = identity.Write([]byte(p.apiKey))
	scope := fmt.Sprintf("%s:%x", baseURL, identity.Sum(nil))
	if o.owners == nil {
		o.owners = map[string]deepSeekImageFileOwner{}
	}
	owner, ok := o.owners[providerID]
	if !ok || owner.scope != scope {
		files, err := flprovider.NewDeepSeekImageFiles(flprovider.DeepSeekImageFilesOptions{BaseURL: baseURL, APIKey: p.apiKey, HTTPClient: p.client, Expiration: time.Hour})
		if err != nil {
			return err
		}
		// Configurations are bounded; evicting an idle owner affects reuse only.
		if len(o.owners) >= 64 && !ok {
			for key := range o.owners {
				delete(o.owners, key)
				break
			}
		}
		owner = deepSeekImageFileOwner{scope: scope, files: files}
		o.owners[providerID] = owner
	}
	p.imageFiles = owner.files
	return nil
}
func (s *Service) deepSeekFiles() *deepSeekImageFileOwners {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deepSeekImageFiles == nil {
		s.deepSeekImageFiles = &deepSeekImageFileOwners{}
	}
	return s.deepSeekImageFiles
}
func (e *desktopModelSourceExecutor) deepSeekFiles() *deepSeekImageFileOwners {
	e.poolMu.Lock()
	defer e.poolMu.Unlock()
	if e.deepSeekImageFiles == nil {
		e.deepSeekImageFiles = &deepSeekImageFileOwners{}
	}
	return e.deepSeekImageFiles
}
