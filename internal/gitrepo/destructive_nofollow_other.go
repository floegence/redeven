//go:build !linux && !darwin

package gitrepo

import (
	"errors"
	"os"
)

var errNoFollowUnavailable = errors.New("no-follow filesystem access unavailable")

func destructiveFileState(os.FileInfo) ([8]uint64, error) {
	return [8]uint64{}, errNoFollowUnavailable
}

func openRootDirectoryNoFollow(string) (*os.File, error) {
	return nil, errNoFollowUnavailable
}

func openDirectoryAtNoFollow(*os.File, string) (*os.File, error) {
	return nil, errNoFollowUnavailable
}

func openRegularAtNoFollow(*os.File, string) (*os.File, error) {
	return nil, errNoFollowUnavailable
}

func readlinkAtNoFollow(*os.File, string, int) (string, error) {
	return "", errNoFollowUnavailable
}
