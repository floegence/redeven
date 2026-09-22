package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
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
		parsed, valid := appserver.NativeCodeSpaceOrigin(origin)
		if !ok || len(values) != 1 || !valid {
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
	raw, err := json.Marshal(values)
	if err != nil || len(raw) > 4096 {
		return nil, errors.New("invalid codespace authorization request")
	}
	var req accessgate.AuthenticationRequest
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&req); err != nil {
		return nil, errors.New("invalid codespace authorization request")
	}
	if len(req.Password) > 1024 || len(req.ChallengeID) > 128 || len(req.Delegation) > 128 || len(req.ResumeToken) > 128 || len(req.Code) > 64 || len(req.RecoveryCode) > 128 {
		return nil, errors.New("invalid codespace authorization request")
	}
	if req.Password != "" || req.ChallengeID != "" || req.Delegation != "" || req.ResumeToken != "" {
		result, err := gate.AuthenticateChannel(meta.ChannelID, req, meta.UserPublicID)
		if err != nil {
			return json.Marshal(map[string]any{"unlocked": false, "password_required": true, "error": err.Error(), "retry_after_ms": accessgate.RetryAfter(err).Milliseconds()})
		}
		return json.Marshal(result)
	}
	return json.Marshal(gate.Status(meta.ChannelID))
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
