package ai

import "context"

// FlowerReadStateCleaner owns only Redeven presentation cache cleanup. It has
// no Floret lifecycle capability and cannot mutate canonical thread state.
type FlowerReadStateCleaner interface {
	RetireFlowerThreadReadState(context.Context, string, string) error
}
