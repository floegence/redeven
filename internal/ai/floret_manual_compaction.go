package ai

import (
	"context"
	"strings"
	"sync/atomic"

	flruntime "github.com/floegence/floret/v4/runtime"
)

const flowerManualCompactionSourceName = "flower_slash_command"

type oneShotManualCompactionSource struct {
	request  flruntime.ManualCompactionRequest
	consumed atomic.Bool
}

func flowerManualCompactionSource(input RunInput, requestID string) flruntime.ManualCompactionSource {
	if strings.TrimSpace(input.Text) != "/compact" ||
		len(input.Attachments) != 0 ||
		input.ContextAction != nil ||
		input.StructuredResponse != nil ||
		len(input.SecretAnswers) != 0 {
		return nil
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil
	}
	return &oneShotManualCompactionSource{request: flruntime.ManualCompactionRequest{
		RequestID: requestID,
		Source:    flowerManualCompactionSourceName,
	}}
}

func (source *oneShotManualCompactionSource) PollManualCompaction(context.Context, flruntime.ManualCompactionPollRequest) (flruntime.ManualCompactionRequest, bool, error) {
	if source == nil || !source.consumed.CompareAndSwap(false, true) {
		return flruntime.ManualCompactionRequest{}, false, nil
	}
	return source.request, true, nil
}
