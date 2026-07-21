package ai

import (
	"context"
	"errors"
	"sync"
)

// floretAuthorityBarrier is the one-way proof that an exact RunTurn no longer
// owns the thread authority. Terminal recovery may settle only after this
// proof is published.
type floretAuthorityBarrier struct {
	once sync.Once
	done chan struct{}
	mu   sync.Mutex
	err  error
}

func newFloretAuthorityBarrier() *floretAuthorityBarrier {
	return &floretAuthorityBarrier{done: make(chan struct{})}
}

func (b *floretAuthorityBarrier) release(err error) {
	if b == nil {
		return
	}
	b.once.Do(func() {
		b.mu.Lock()
		b.err = err
		b.mu.Unlock()
		close(b.done)
	})
}

func (b *floretAuthorityBarrier) wait() error {
	return b.waitContext(context.Background())
}

func (b *floretAuthorityBarrier) waitContext(ctx context.Context) error {
	if b == nil {
		return errors.New("Floret authority barrier is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-b.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	b.mu.Lock()
	err := b.err
	b.mu.Unlock()
	return err
}
