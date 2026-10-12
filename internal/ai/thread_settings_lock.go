package ai

import "context"

type threadSettingsLockKey struct {
	endpointID string
	threadID   string
}

type threadSettingsLock struct {
	token chan struct{}
	users int
}

// lockThreadSettings keeps same-thread admission and setting changes ordered
// without making unrelated threads wait for preparation or provider work.
func (s *Service) lockThreadSettings(ctx context.Context, endpointID, threadID string) (func(), error) {
	key := threadSettingsLockKey{endpointID: endpointID, threadID: threadID}
	s.threadSettingsLocksMu.Lock()
	if s.threadSettingsLocks == nil {
		s.threadSettingsLocks = make(map[threadSettingsLockKey]*threadSettingsLock)
	}
	lock := s.threadSettingsLocks[key]
	if lock == nil {
		lock = &threadSettingsLock{token: make(chan struct{}, 1)}
		lock.token <- struct{}{}
		s.threadSettingsLocks[key] = lock
	}
	lock.users++
	s.threadSettingsLocksMu.Unlock()
	releaseUser := func() {
		s.threadSettingsLocksMu.Lock()
		lock.users--
		if lock.users == 0 {
			delete(s.threadSettingsLocks, key)
		}
		s.threadSettingsLocksMu.Unlock()
	}
	select {
	case <-ctx.Done():
		releaseUser()
		return nil, ctx.Err()
	case <-lock.token:
		return func() {
			lock.token <- struct{}{}
			releaseUser()
		}, nil
	}
}
