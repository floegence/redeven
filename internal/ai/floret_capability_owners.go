package ai

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

type floretReadCapabilities struct {
	thread   floretThreadReadHostFactory
	subagent floretSubagentReadHostFactory
}

func (c *floretReadCapabilities) openThread(ctx context.Context, threadID string) (floretThreadReadHost, error) {
	if c == nil || c.thread == nil {
		return nil, errors.New("Floret thread read capability is unavailable")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("Floret thread read identity is incomplete")
	}
	return c.thread(ctxOrBackground(ctx), flruntime.ThreadID(threadID))
}

func (c *floretReadCapabilities) openSubagent(ctx context.Context, parentThreadID string) (floretSubagentReadHost, error) {
	if c == nil || c.subagent == nil {
		return nil, errors.New("Floret SubAgent read capability is unavailable")
	}
	parentThreadID = strings.TrimSpace(parentThreadID)
	if parentThreadID == "" {
		return nil, errors.New("Floret SubAgent read identity is incomplete")
	}
	return c.subagent(ctxOrBackground(ctx), flruntime.ThreadID(parentThreadID))
}

type floretRuntimeCapabilityIssuer struct {
	bind floretThreadRuntimeBinder
}

func (i *floretRuntimeCapabilityIssuer) bindThread(threadID string) (floretThreadRuntimeCapabilities, error) {
	if i == nil || i.bind == nil {
		return floretThreadRuntimeCapabilities{}, errors.New("Floret runtime capability issuer is unavailable")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return floretThreadRuntimeCapabilities{}, errors.New("Floret runtime authority identity is incomplete")
	}
	return i.bind(flruntime.ThreadID(threadID))
}
