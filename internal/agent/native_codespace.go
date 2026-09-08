package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/session"
)

func (a *Agent) registerNativeCodeSpaceStreams(ctx context.Context, handlers *flowersec.StreamHandlers, meta *session.Meta) (func(), error) {
	binding, err := a.code.BindRunningCodeSpace(ctx, meta.CodeSpaceID)
	if err != nil {
		return nil, err
	}
	lifetime, cancel := context.WithCancel(ctx)
	stopInstance := context.AfterFunc(binding.Context, cancel)
	binding.Context = lifetime
	handler, closeHandler, err := appserver.NewNativeCodeSpaceHandler(binding)
	if err != nil {
		stopInstance()
		cancel()
		return nil, err
	}
	var once sync.Once
	cleanup := func() { once.Do(func() { stopInstance(); cancel(); closeHandler() }) }
	if err := handlers.HandleStream("code/auth_v1", func(streamCtx context.Context, incoming flowersec.IncomingStream) error {
		if lifetime.Err() != nil {
			return errors.New("codespace instance closed")
		}
		body, err := nativeCodeSpaceAuthorization(a.accessGate, meta, incoming.Metadata.Values())
		if err != nil {
			return err
		}
		_, err = incoming.Stream.Write(body)
		return err
	}); err != nil {
		cleanup()
		return nil, err
	}
	if err := handlers.HandleStream("code/http_v1", func(streamCtx context.Context, incoming flowersec.IncomingStream) error {
		values := incoming.Metadata.Values()
		origin, ok := values["presentation_origin"].(string)
		parsed, err := url.Parse(origin)
		if !ok || len(values) != 1 || len(origin) > 128 || err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" || parsed.String() != parsed.Scheme+"://"+parsed.Host {
			return errors.New("invalid native presentation origin")
		}
		if lifetime.Err() != nil {
			return errors.New("codespace instance closed")
		}
		connectionCtx, stop := context.WithCancel(streamCtx)
		defer stop()
		stopLifetime := context.AfterFunc(lifetime, stop)
		defer stopLifetime()
		guarded := nativeCodeSpaceRequestGuard(handler, meta, a.accessGate, parsed.Host)
		return flowersec.ServeHTTPStream(connectionCtx, incoming.Stream, guarded, flowersec.HTTPStreamOptions{})
	}); err != nil {
		cleanup()
		return nil, err
	}
	return cleanup, nil
}

// Authorization uses the existing channel scope; no Env App resume token is promoted.
func nativeCodeSpaceAuthorization(gate *accessgate.Gate, meta *session.Meta, values map[string]any) ([]byte, error) {
	password := ""
	if len(values) > 0 {
		value, ok := values["password"].(string)
		if !ok || len(values) != 1 || len(value) > 1024 {
			return nil, errors.New("invalid codespace authorization request")
		}
		password = value
	}
	if password != "" {
		if _, err := gate.UnlockChannelWithSubject(meta.ChannelID, password, meta.UserPublicID); err != nil {
			return []byte(`{"unlocked":false,"password_required":true}`), nil
		}
	}
	status := gate.Status(meta.ChannelID)
	return json.Marshal(map[string]bool{"unlocked": status.Unlocked, "password_required": status.PasswordRequired})
}

func nativeCodeSpaceRequestGuard(handler http.Handler, meta *session.Meta, gate *accessgate.Gate, authority string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != authority || !strings.HasPrefix(r.RequestURI, "/") || strings.HasPrefix(r.RequestURI, "//") {
			http.Error(w, "invalid native authority", http.StatusBadRequest)
			return
		}
		if !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			http.Error(w, "permission denied", http.StatusForbidden)
			return
		}
		if gate.Enabled() && !gate.IsChannelUnlocked(meta.ChannelID) {
			http.Error(w, "access password required", http.StatusLocked)
			return
		}
		r.Header.Del("X-Redeven-Code-Origin")
		handler.ServeHTTP(w, r)
	})
}
