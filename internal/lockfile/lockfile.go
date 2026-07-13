package lockfile

import (
	"errors"
	"fmt"
	"io"
	"os"
)

var (
	// ErrAlreadyLocked indicates the lock is held by another process.
	ErrAlreadyLocked = errors.New("lock already held")
)

type Lock struct {
	path string
	f    *os.File
}

func Acquire(path string) (*Lock, error) {
	if path == "" {
		return nil, fmt.Errorf("lock path is empty")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lockFile(f); err != nil {
		_ = f.Close()
		return nil, err
	}

	// Best-effort: write pid for troubleshooting.
	_ = f.Truncate(0)
	_, _ = f.Seek(0, 0)
	_, _ = fmt.Fprintf(f, "%d\n", os.Getpid())
	_ = f.Sync()

	return &Lock{path: path, f: f}, nil
}

func ReadContent(path string) ([]byte, error) {
	if path == "" {
		return nil, fmt.Errorf("lock path is empty")
	}
	return os.ReadFile(path)
}

// RetireIf takes the existing lock without changing its content, evaluates the
// active lease while holding the lock, and clears it only when the callback
// confirms that the lease is safe to retire.
func RetireIf(path string, shouldRetire func([]byte) (bool, error)) (bool, error) {
	if path == "" {
		return false, fmt.Errorf("lock path is empty")
	}
	if shouldRetire == nil {
		return false, fmt.Errorf("missing lock retirement predicate")
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0o600)
	if err != nil {
		return false, err
	}
	if err := lockFile(f); err != nil {
		_ = f.Close()
		return false, err
	}
	unlockAndClose := func() error {
		unlockErr := unlockFile(f)
		closeErr := f.Close()
		if unlockErr != nil {
			return unlockErr
		}
		return closeErr
	}
	if _, err := f.Seek(0, 0); err != nil {
		_ = unlockAndClose()
		return false, err
	}
	body, err := io.ReadAll(f)
	if err != nil {
		_ = unlockAndClose()
		return false, err
	}
	retire, err := shouldRetire(body)
	if err != nil {
		_ = unlockAndClose()
		return false, err
	}
	if retire {
		if err := f.Truncate(0); err != nil {
			_ = unlockAndClose()
			return false, err
		}
		if _, err := f.Seek(0, 0); err != nil {
			_ = unlockAndClose()
			return false, err
		}
		if err := f.Sync(); err != nil {
			_ = unlockAndClose()
			return false, err
		}
	}
	if err := unlockAndClose(); err != nil {
		return false, err
	}
	return retire, nil
}

func (l *Lock) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

func (l *Lock) SetContent(body []byte) error {
	if l == nil || l.f == nil {
		return fmt.Errorf("lock is not held")
	}
	if err := l.f.Truncate(0); err != nil {
		return err
	}
	if _, err := l.f.Seek(0, 0); err != nil {
		return err
	}
	if len(body) > 0 {
		if _, err := l.f.Write(body); err != nil {
			return err
		}
	}
	return l.f.Sync()
}

func (l *Lock) Release() error {
	if l == nil || l.f == nil {
		return nil
	}
	// The file content represents the active lease, so retire it while the
	// lock is still held and before another process can acquire the path.
	clearErr := l.SetContent(nil)
	unlockErr := unlockFile(l.f)
	closeErr := l.f.Close()
	l.f = nil
	if clearErr != nil {
		return clearErr
	}
	if unlockErr != nil {
		return unlockErr
	}
	return closeErr
}
