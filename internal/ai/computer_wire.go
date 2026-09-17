package ai

import (
	"bufio"
	"errors"
)

// Bound JSONL before decoding. Helpers may carry pixels, but never unbounded
// output or an exception containing the process environment.
func readComputerLine(reader *bufio.Reader, limit int) ([]byte, error) {
	var body []byte
	for {
		part, err := reader.ReadSlice('\n')
		if len(body)+len(part) > limit {
			return nil, errors.New("computer helper response exceeds its limit")
		}
		body = append(body, part...)
		if err == nil {
			return body, nil
		}
		if !errors.Is(err, bufio.ErrBufferFull) {
			return nil, err
		}
	}
}
