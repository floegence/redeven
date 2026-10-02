package agent

import (
	"context"
	"errors"
	"strings"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/runtimeproxy"
	"github.com/floegence/redeven/internal/session"
)

func (a *Agent) registerWindowSessionProxy(handlers flowersec.StreamHandlerRegistrar, meta *session.Meta, origin string, ready <-chan struct{}) (func(), error) {
	if a == nil || a.code == nil || meta == nil || meta.FloeApp != FloeAppRedevenPortForward || strings.TrimSpace(meta.CodeSpaceID) == "" ||
		!meta.CanRead || !meta.CanWrite || !meta.CanExecute || strings.TrimSpace(origin) == "" {
		return nil, errors.New("invalid window session authority")
	}
	upstream := strings.TrimSpace(a.code.AppServerURL())
	if upstream == "" {
		return nil, errors.New("code app server not ready")
	}
	upstream, closeUpstream, err := a.prepareAccessProxyUpstream(context.Background(), meta, upstream, origin, ready)
	if err != nil {
		return nil, err
	}
	proxy, err := runtimeproxy.RegisterStreamHandlers(handlers, runtimeproxy.Options{Upstream: upstream, UpstreamOrigin: origin, BlockedResponseHeaders: runtimeproxy.ProductBlockedResponseHeaders()})
	if err != nil {
		closeUpstream()
		return nil, err
	}
	return func() { _ = proxy.Close(); closeUpstream() }, nil
}
