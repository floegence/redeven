package agent

import (
	"context"
	"errors"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func (a *Agent) registerBrowserStreams(streams interface {
	HandleStream(string, flowersec.StreamHandler) error
}, meta *session.Meta) (func(), error) {
	cleanup := func() {}
	if a.browserRuntime == nil || meta == nil || meta.FloeApp != FloeAppRedevenAgent || meta.CodeSpaceID != "env-ui" {
		return cleanup, nil
	}
	cleanup = func() { a.browserRuntime.CloseBrowserChannel(meta) }
	for _, kind := range []string{ai.BrowserDOMStream, ai.BrowserInputStream, ai.BrowserMediaStream, ai.BrowserUploadStream} {
		if err := streams.HandleStream(kind, func(ctx context.Context, incoming flowersec.IncomingStream) error {
			if incoming.Stream == nil {
				return errors.New("browser stream unavailable")
			}
			return a.browserRuntime.ServeBrowserStream(ctx, incoming.Stream, meta, a.accessGate, kind)
		}); err != nil {
			return cleanup, err
		}
	}
	return cleanup, nil
}
